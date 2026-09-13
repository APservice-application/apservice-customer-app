import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

type Role = 'rider' | 'store_owner'
type LoginRole = Role | 'admin'
type ManagedRole = Role | 'customer' | 'admin'
type RoleProfile = { user_id: string; email: string; login_id: string | null }
type RiderEntity = { id: string; name: string; emoji?: string; phone?: string; vehicle?: string; status?: string; lastLocation?: unknown }
type StoreEntity = {
  id: string; name: string; emoji?: string; desc?: string; rating?: number; eta?: string; phone?: string; location?: unknown; active?: boolean;
  legal_name?: string; registration_number?: string; contact_name?: string; contact_email?: string;
  registered_address?: string; pickup_address?: string; delivery_address?: string; registration_document_url?: string; category_id?: string;
}
type LocalOrder = {
  id?: unknown; storeId?: unknown; storeName?: unknown; serviceType?: unknown; status?: unknown; riderId?: unknown; riderName?: unknown;
  customerEmail?: unknown; name?: unknown; total?: unknown; creditUsed?: unknown; payable?: unknown; deliveryFee?: unknown;
  pickupAddress?: unknown; pickupLocation?: unknown; deliveryAddress?: unknown; address?: unknown; deliveryLocation?: unknown;
  distanceKm?: unknown; note?: unknown; orderedAt?: unknown; acceptedAt?: unknown; deliveryStartedAt?: unknown; completedAt?: unknown;
  items?: unknown[]
}
type OrderItemInput = { id?: unknown; item_id?: unknown; name?: unknown; emoji?: unknown; unit_price?: unknown; quantity?: unknown; options?: unknown }

const ORDER_STATUS = Object.freeze({
  ADMIN_REVIEW: 'รอแอดมินตรวจสอบ', PAYMENT_REVIEW: 'รอตรวจสอบการชำระเงิน', PAYMENT_RETRY: 'ต้องแนบสลิปใหม่', CREDIT_REVIEW: 'รอตรวจสอบเครดิต',
  STORE_ACCEPTED: 'ร้านค้ารับออร์เดอร์', PREPARING: 'กำลังเตรียมสินค้า', RIDER_PICKUP: 'ไรเดอร์กำลังไปรับ',
  ARRIVED_STORE: 'ถึงร้านค้า', COLLECTED: 'รับสินค้าแล้ว', DELIVERING: 'กำลังไปส่ง', COMPLETED: 'สำเร็จแล้ว', CANCELLED: 'ยกเลิก',
})
const ORDER_TRANSITIONS: Record<string, string[]> = {
  [ORDER_STATUS.ADMIN_REVIEW]: [ORDER_STATUS.STORE_ACCEPTED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAYMENT_REVIEW]: [ORDER_STATUS.STORE_ACCEPTED, ORDER_STATUS.PAYMENT_RETRY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAYMENT_RETRY]: [ORDER_STATUS.PAYMENT_REVIEW, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CREDIT_REVIEW]: [ORDER_STATUS.STORE_ACCEPTED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.STORE_ACCEPTED]: [ORDER_STATUS.PREPARING, ORDER_STATUS.RIDER_PICKUP, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PREPARING]: [ORDER_STATUS.RIDER_PICKUP, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.RIDER_PICKUP]: [ORDER_STATUS.ARRIVED_STORE, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.ARRIVED_STORE]: [ORDER_STATUS.COLLECTED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.COLLECTED]: [ORDER_STATUS.DELIVERING, ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERING]: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.COMPLETED]: [], [ORDER_STATUS.CANCELLED]: [],
}
const TERMINAL_ORDER_STATUSES = new Set([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED])
const EDITABLE_ORDER_STATUSES = new Set([ORDER_STATUS.PAYMENT_REVIEW, ORDER_STATUS.PAYMENT_RETRY, ORDER_STATUS.CREDIT_REVIEW, ORDER_STATUS.ADMIN_REVIEW, ORDER_STATUS.STORE_ACCEPTED, ORDER_STATUS.PREPARING])

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders })
const isRole = (value: unknown): value is Role => value === 'rider' || value === 'store_owner'
const isLoginRole = (value: unknown): value is LoginRole => value === 'admin' || value === 'rider' || value === 'store_owner'
const isManagedRole = (value: unknown): value is ManagedRole => value === 'customer' || value === 'rider' || value === 'store_owner' || value === 'admin'
const normalizedId = (value: unknown) => String(value || '').trim().toLowerCase()
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const loginIdIsValid = (value: string) => /^[a-z0-9][a-z0-9._-]{2,31}$/.test(value)
const INTERNAL_EMAIL_DOMAIN = 'internal.apservice.local'
const internalEmailFor = (loginId: string) => `${loginId}@${INTERNAL_EMAIL_DOMAIN}`
const text = (value: unknown, fallback = '') => String(value ?? fallback).trim()
const number = (value: unknown) => Math.max(0, Number(value) || 0)
const validDate = (value: unknown) => { const date = new Date(String(value || '')); return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString() }
const secureTemporaryPassword = (value: string) => value.length >= 12 && value.length <= 128 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value) && !/\s/.test(value)
const riderLocation = (value: unknown) => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const lat = Number(source.lat), lng = Number(source.lng), accuracy = Number(source.accuracy)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng, accuracy: Number.isFinite(accuracy) ? Math.min(50_000, Math.max(0, accuracy)) : null, captured_at: validDate(source.captured_at), source: 'rider-device' }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: 'Function environment is incomplete' }, 500)
    const body = await request.json() as Record<string, unknown>
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

    if (body.action === 'login') {
      const role = body.role, identifier = normalizedId(body.identifier), password = String(body.password || '')
      if (!isLoginRole(role) || !loginIdIsValid(identifier) || !password) return json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ครบถ้วน' }, 400)
      const profileResult = await admin.from('user_profiles').select('user_id,email,login_id').eq('login_id', identifier).maybeSingle()
      if (profileResult.error || !profileResult.data) return json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401)
      const profile = profileResult.data as RoleProfile
      const { data: roleRow } = await admin.from('user_roles').select('role').eq('user_id', profile.user_id).eq('role', role).maybeSingle()
      if (!roleRow) return json({ error: 'บัญชีนี้ไม่มีสิทธิ์ใช้งานแอปที่เลือก' }, 403)
      const { data: accountControl } = await admin.from('account_controls').select('status,suspension_reason').eq('user_id', profile.user_id).maybeSingle()
      if (accountControl?.status === 'suspended') return json({ error: `บัญชีนี้ถูกระงับ${accountControl.suspension_reason ? `: ${accountControl.suspension_reason}` : ''}` }, 403)
      let entityId: string | null = null
      let entityError: { message?: string } | null = null
      if (role === 'rider') {
        const result = await admin.from('riders').select('id').eq('user_id', profile.user_id); entityId = result.data?.[0]?.id || null; entityError = result.error
      } else if (role !== 'admin') {
        const result = await admin.from('stores').select('id').eq('owner_id', profile.user_id); entityId = result.data?.[0]?.id || null; entityError = result.error
      }
      if (entityError || (role !== 'admin' && !entityId)) return json({ error: 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลการทำงาน โปรดติดต่อผู้ดูแล' }, 403)
      if (!looksLikeEmail(String(profile.email || ''))) return json({ error: 'บัญชีภายในยังตั้งค่าไม่สมบูรณ์ โปรดติดต่อผู้ดูแล' }, 503)
      const auth = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
      const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({ email: profile.email, password })
      if (signInError || !signedIn.session) return json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401)
      return json({ session: signedIn.session, user: signedIn.user, role, entity_id: entityId, login_id: profile.login_id })
    }

    const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!accessToken) return json({ error: 'ต้องเข้าสู่ระบบผู้ดูแลก่อนจัดการบัญชีหรือซิงก์ออร์เดอร์' }, 401)
    const { data: callerResult, error: callerError } = await admin.auth.getUser(accessToken)
    const caller = callerResult.user
    if (callerError || !caller) return json({ error: 'ไม่สามารถยืนยันผู้ดูแลระบบได้' }, 401)

    if (body.action === 'report_rider_delivery_issue') {
      const orderId = text(body.order_id)
      const issueType = text(body.issue_type)
      const detail = text(body.detail)
      const evidencePath = text(body.evidence_path)
      const allowedIssueTypes = new Set(['vehicle_breakdown', 'customer_unreachable', 'accident', 'incorrect_pin', 'severe_weather', 'other'])
      if (!orderId || !allowedIssueTypes.has(issueType)) return json({ error: 'กรุณาเลือกรายการงานและประเภทปัญหาที่ถูกต้อง' }, 400)
      if (detail.length > 500 || (issueType === 'other' && detail.length < 3)) return json({ error: issueType === 'other' ? 'กรุณาระบุรายละเอียดปัญหาอย่างน้อย 3 ตัวอักษร' : 'รายละเอียดปัญหายาวเกิน 500 ตัวอักษร' }, 400)
      const { data: riderRole } = await admin.from('user_roles').select('role').eq('user_id', caller.id).eq('role', 'rider').maybeSingle()
      if (!riderRole) return json({ error: 'เฉพาะบัญชี Rider ที่ยืนยันตัวตนแล้วเท่านั้นที่แจ้งปัญหาระหว่างส่งได้' }, 403)
      const { data: rider, error: riderError } = await admin.from('riders').select('id,user_id').eq('user_id', caller.id).maybeSingle()
      if (riderError) return json({ error: riderError.message }, 400)
      if (!rider) return json({ error: 'ไม่พบโปรไฟล์ Rider ที่ผูกกับบัญชีนี้' }, 404)
      const { data: order, error: orderError } = await admin.from('delivery_orders').select('id,rider_id,status').eq('id', orderId).maybeSingle()
      if (orderError) return json({ error: orderError.message }, 400)
      if (!order || order.rider_id !== rider.id) return json({ error: 'ไม่พบงานที่เป็นของ Rider บัญชีนี้' }, 404)
      if (['สำเร็จแล้ว', 'ยกเลิก'].includes(String(order.status || ''))) return json({ error: 'งานนี้ปิดแล้ว จึงแจ้งปัญหาระหว่างส่งไม่ได้' }, 409)
      if (evidencePath) {
        const allowedPrefix = `delivery-proofs/${caller.id}/${orderId}-issue/`
        if (evidencePath.length > 1024 || !evidencePath.startsWith(allowedPrefix)) return json({ error: 'หลักฐานต้องเป็นไฟล์ private ที่ Rider อัปโหลดสำหรับงานนี้เท่านั้น' }, 400)
      }
      const { data: issue, error: issueError } = await admin.from('rider_delivery_issues').insert({ order_id: orderId, rider_id: rider.id, reported_by: caller.id, issue_type: issueType, detail, evidence_path: evidencePath || null, status: 'open' }).select('id,order_id,rider_id,issue_type,detail,evidence_path,status,created_at').single()
      if (issueError) return json({ error: issueError.message }, 400)
      return json({ ok: true, issue })
    }

    if (body.action === 'update_rider_presence') {
      const { data: riderRole } = await admin.from('user_roles').select('role').eq('user_id', caller.id).eq('role', 'rider').maybeSingle()
      if (!riderRole) return json({ error: 'เฉพาะบัญชี Rider ที่ยืนยันตัวตนแล้วเท่านั้นที่อัปเดตสถานะหรือพิกัดได้' }, 403)
      const { data: rider, error: riderError } = await admin.from('riders').select('id,user_id,name,phone,vehicle,status,ride_available,last_location,compliance_status,updated_at').eq('user_id', caller.id).maybeSingle()
      if (riderError) return json({ error: riderError.message }, 400)
      if (!rider) return json({ error: 'ไม่พบโปรไฟล์ Rider ที่ผูกกับบัญชีนี้' }, 404)
      const operation = text(body.operation)
      const input = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

      if (operation === 'location') {
        const location = riderLocation(input.location)
        if (!location) return json({ error: 'พิกัดตำแหน่งไม่ถูกต้อง กรุณาเปิด GPS แล้วลองใหม่' }, 400)
        updates.last_location = location
      } else if (operation === 'availability') {
        if (typeof input.available !== 'boolean') return json({ error: 'กรุณาระบุสถานะพร้อมรับงานให้ถูกต้อง' }, 400)
        if (input.available && rider.compliance_status !== 'approved') return json({ error: 'บัญชี Rider ยังไม่ผ่านการอนุมัติ จึงยังเปิดรับงานไม่ได้' }, 409)
        updates.ride_available = input.available
        updates.status = input.available ? 'พร้อมรับงาน' : 'ไม่พร้อมรับงาน'
      } else if (operation === 'profile') {
        const name = text(input.name), phone = text(input.phone), vehicle = text(input.vehicle)
        if (!name || name.length > 120) return json({ error: 'ชื่อ Rider ต้องมีความยาว 1–120 ตัวอักษร' }, 400)
        if (phone.length > 32 || vehicle.length > 80) return json({ error: 'ข้อมูลติดต่อหรือยานพาหนะยาวเกินกำหนด' }, 400)
        updates.name = name
        updates.phone = phone
        updates.vehicle = vehicle
      } else if (operation === 'documents') {
        const fields = ['identity_document_image_url', 'license_image_url', 'vehicle_registration_image_url', 'insurance_image_url']
        let submitted = 0
        const documentRefs: Record<string, string> = {}
        for (const field of fields) { const ref = text(input[field]); if (!ref) continue; if (ref.length > 600 || !ref.startsWith(`rider-${rider.id}/`)) return json({ error: 'ตำแหน่งเอกสาร Rider ไม่ถูกต้อง' }, 400); documentRefs[field] = ref; submitted += 1 }
        if (!submitted) return json({ error: 'กรุณาเลือกเอกสารอย่างน้อยหนึ่งรายการก่อนส่งตรวจ' }, 400)
        Object.assign(updates, documentRefs)
        updates.compliance_status = 'pending'; updates.compliance_note = 'Rider ส่งเอกสารใหม่ รอผู้ดูแลตรวจ'; updates.compliance_reviewed_by = null; updates.compliance_reviewed_at = null; updates.ride_available = false; updates.status = 'ไม่พร้อมรับงาน'
      } else return json({ error: 'คำสั่งอัปเดตข้อมูล Rider ไม่รองรับ' }, 400)

      const { data: updated, error: updateError } = await admin.from('riders').update(updates).eq('id', rider.id).select('id,user_id,name,phone,vehicle,status,ride_available,last_location,compliance_status,updated_at').single()
      if (updateError) return json({ error: updateError.message }, 400)
      return json({ ok: true, operation, rider: updated })
    }

    const { data: adminRole } = await admin.from('user_roles').select('role').eq('user_id', caller.id).eq('role', 'admin').maybeSingle()
    if (!adminRole) return json({ error: 'เฉพาะผู้ดูแลระบบที่มีสิทธิ์ใน Supabase เท่านั้นที่ดำเนินการได้' }, 403)
    const callerDb = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } })

    if (body.action === 'review_rider_compliance') {
      const riderId = text(body.rider_id), decision = text(body.decision), note = text(body.note)
      if (!riderId || !['approved', 'rejected'].includes(decision) || note.length < 3) return json({ error: 'กรุณาระบุ Rider ผลพิจารณา และเหตุผลอย่างน้อย 3 ตัวอักษร' }, 400)
      const { data: rider, error: riderError } = await admin.from('riders').select('id,user_id,identity_verified,identity_document_image_url,license_number,license_expiry,license_image_url,vehicle_registration_image_url,insurance_expiry,insurance_image_url,compliance_status,ride_available,status').eq('id', riderId).maybeSingle()
      if (riderError) return json({ error: riderError.message }, 400)
      if (!rider) return json({ error: 'ไม่พบ Rider ที่ต้องการพิจารณา' }, 404)
      if (decision === 'approved') {
        const licenseValid = rider.license_expiry && new Date(rider.license_expiry).getTime() >= new Date(new Date().toISOString().slice(0, 10)).getTime()
        const insuranceValid = rider.insurance_expiry && new Date(rider.insurance_expiry).getTime() >= new Date(new Date().toISOString().slice(0, 10)).getTime()
        if (!rider.identity_verified || !rider.identity_document_image_url || !rider.license_number || !licenseValid || !rider.license_image_url || !rider.vehicle_registration_image_url || !insuranceValid || !rider.insurance_image_url) return json({ error: 'เอกสารยืนยันตัวตน ใบขับขี่ ทะเบียนรถ หรือประกันยังไม่ครบ/หมดอายุ จึงอนุมัติไม่ได้' }, 409)
      }
      const updates: Record<string, unknown> = { compliance_status: decision, compliance_note: note, compliance_reviewed_by: caller.id, compliance_reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      if (decision !== 'approved') { updates.ride_available = false; updates.status = 'ไม่พร้อมรับงาน' }
      const { data: updated, error: updateError } = await admin.from('riders').update(updates).eq('id', riderId).select('id,compliance_status,compliance_note,compliance_reviewed_at,ride_available,status').single()
      if (updateError) return json({ error: updateError.message }, 400)
      await admin.from('admin_action_audit').insert({ actor_id: caller.id, target_user_id: rider.user_id || null, action: 'rider_compliance_reviewed', reason: note, before_state: { rider_id: riderId, compliance_status: rider.compliance_status, ride_available: rider.ride_available }, after_state: { rider_id: riderId, compliance_status: updated.compliance_status, ride_available: updated.ride_available } })
      return json({ ok: true, rider: updated })
    }

    if (body.action === 'update_store_gp_rate') {
      const storeId = text(body.store_id), gpPercent = Number(body.gp_percent), reason = text(body.reason)
      if (!storeId || !Number.isFinite(gpPercent) || gpPercent < 0 || gpPercent > 100 || reason.length < 3 || reason.length > 500) return json({ error: 'กรุณาระบุร้าน อัตรา GP 0–100 และเหตุผล 3–500 ตัวอักษร' }, 400)
      const { data: store, error: storeError } = await admin.from('stores').select('id,owner_id,settlement_gp_percent').eq('id', storeId).maybeSingle()
      if (storeError) return json({ error: storeError.message }, 400)
      if (!store) return json({ error: 'ไม่พบร้านค้าที่ต้องการตั้งค่า GP' }, 404)
      const normalized = Math.round(gpPercent * 100) / 100
      const { error: updateError } = await admin.from('stores').update({ settlement_gp_percent: normalized, updated_at: new Date().toISOString() }).eq('id', storeId)
      if (updateError) return json({ error: updateError.message }, 400)
      const { error: historyError } = await admin.from('store_gp_rate_history').insert({ store_id: storeId, previous_gp_percent: Number(store.settlement_gp_percent || 0), gp_percent: normalized, reason, changed_by: caller.id })
      if (historyError) return json({ error: historyError.message }, 400)
      await admin.from('admin_action_audit').insert({ actor_id: caller.id, target_user_id: store.owner_id || null, action: 'store_gp_rate_updated', reason, before_state: { store_id: storeId, gp_percent: Number(store.settlement_gp_percent || 0) }, after_state: { store_id: storeId, gp_percent: normalized } })
      return json({ ok: true, store_id: storeId, gp_percent: normalized })
    }

    if (body.action === 'migrate_orders') {
      const source = Array.isArray(body.orders) ? body.orders.slice(0, 100) as LocalOrder[] : []
      if (!source.length) return json({ imported: 0 })
      const riderIds = [...new Set(source.map(order => text(order.riderId)).filter(Boolean))]
      const storeIds = [...new Set(source.map(order => text(order.storeId)).filter(Boolean))]
      const [{ data: riders, error: ridersError }, { data: stores, error: storesError }] = await Promise.all([
        riderIds.length ? admin.from('riders').select('id').in('id', riderIds) : Promise.resolve({ data: [], error: null }),
        storeIds.length ? admin.from('stores').select('id').in('id', storeIds) : Promise.resolve({ data: [], error: null }),
      ])
      if (ridersError || storesError) return json({ error: ridersError?.message || storesError?.message || 'ไม่สามารถตรวจสอบข้อมูลอ้างอิงของออร์เดอร์' }, 400)
      const riderSet = new Set((riders || []).map(row => row.id)), storeSet = new Set((stores || []).map(row => row.id))
      const orders = source.map(order => {
        const id = text(order.id)
        if (!id) throw new Error('พบออร์เดอร์ที่ไม่มีรหัสอ้างอิง')
        const riderId = text(order.riderId)
        return {
          id, customer_id: null, customer_email: text(order.customerEmail), customer_name: text(order.name, 'ลูกค้า AP Service'),
          store_id: storeSet.has(text(order.storeId)) ? text(order.storeId) : null, store_name: text(order.storeName, 'บริการจัดส่ง'),
          rider_id: riderSet.has(riderId) ? riderId : null, rider_name: riderSet.has(riderId) ? text(order.riderName) : null,
          service_type: text(order.serviceType, 'food'), status: text(order.status, 'กำลังดำเนินการ'), total: number(order.total),
          credit_used: number(order.creditUsed), payable: number(order.payable ?? order.total), delivery_fee: number(order.deliveryFee),
          pickup_address: text(order.pickupAddress), pickup_location: order.pickupLocation || null, delivery_address: text(order.deliveryAddress ?? order.address),
          delivery_location: order.deliveryLocation || null, distance_km: Number.isFinite(Number(order.distanceKm)) ? Number(order.distanceKm) : null,
          note: text(order.note), ordered_at: validDate(order.orderedAt), accepted_at: order.acceptedAt ? validDate(order.acceptedAt) : null,
          delivery_started_at: order.deliveryStartedAt ? validDate(order.deliveryStartedAt) : null, completed_at: order.completedAt ? validDate(order.completedAt) : null,
          updated_at: new Date().toISOString(),
        }
      })
      const { error: orderError } = await admin.from('delivery_orders').upsert(orders, { onConflict: 'id' })
      if (orderError) return json({ error: orderError.message }, 400)
      const items = source.flatMap(order => (Array.isArray(order.items) ? order.items : []).map((item: Record<string, unknown>) => ({
        order_id: text(order.id), item_id: text(item.foodId ?? item.id) || null, name: text(item.name, 'สินค้า'), emoji: text(item.emoji, '🍜'), unit_price: number(item.price), quantity: Math.max(1, Math.trunc(Number(item.qty) || 1)), options: item.options || {},
      }))).filter(item => item.order_id)
      const orderIds = orders.map(order => order.id)
      if (items.length) { await admin.from('delivery_order_items').delete().in('order_id', orderIds); const { error: itemsError } = await admin.from('delivery_order_items').insert(items); if (itemsError) return json({ error: itemsError.message }, 400) }
      return json({ imported: orders.length, item_count: items.length })
    }

    if (body.action === 'list_store_accounts') {
      const { data: stores, error: storesError } = await admin.from('stores').select('id,owner_id,owner_email,name,emoji,description,rating,eta,phone,location,active,image_url,background_url,open_time,close_time,order_cutoff_minutes,emergency_closed,emergency_note,category_id,moderation_status,moderation_reason,moderation_changed_at').order('name', { ascending: true }).limit(500)
      if (storesError) return json({ error: storesError.message }, 400)
      const ownerIds = (stores || []).map(store => store.owner_id).filter(Boolean)
      const { data: profiles, error: profilesError } = ownerIds.length ? await admin.from('user_profiles').select('user_id,email,login_id,phone').in('user_id', ownerIds) : { data: [], error: null }
      if (profilesError) return json({ error: profilesError.message }, 400)
      const profileByUser = new Map((profiles || []).map(profile => [profile.user_id, profile]))
      return json({ ok: true, stores: (stores || []).map(store => ({ ...store, account: store.owner_id ? profileByUser.get(store.owner_id) || null : null })) })
    }

    if (body.action === 'moderate_store') {
      const entityId = text(body.entity_id), action = text(body.moderation_action), reason = text(body.reason)
      if (!entityId || !['active', 'suspended', 'archived'].includes(action)) return json({ error: 'กรุณาเลือกร้านค้าและคำสั่งจัดการที่ถูกต้อง' }, 400)
      if (action !== 'active' && reason.length < 3) return json({ error: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษรเพื่อบันทึกประวัติ' }, 400)
      const { data: store, error: storeError } = await admin.from('stores').select('id,name').eq('id', entityId).maybeSingle()
      if (storeError) return json({ error: storeError.message }, 400)
      if (!store) return json({ error: 'ไม่พบร้านค้าที่ต้องการจัดการ' }, 404)
      const now = new Date().toISOString()
      const { error: updateError } = await admin.from('stores').update({ active: action === 'active', moderation_status: action, moderation_reason: reason || null, moderation_changed_at: now, moderation_changed_by: caller.id, updated_at: now }).eq('id', entityId)
      if (updateError) return json({ error: updateError.message }, 400)
      const { error: eventError } = await admin.from('store_moderation_events').insert({ store_id: entityId, action, reason, performed_by: caller.id })
      if (eventError) return json({ error: eventError.message }, 400)
      return json({ ok: true, entity_id: entityId, action, reason, store_name: store.name })
    }

    if (body.action === 'update_store_section') {
      const entityId = text(body.entity_id)
      const section = text(body.section)
      const input = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>
      const allowedStoreSections = ['general', 'appearance', 'operations']
      const legacyStoreSections = ['identity', 'addresses', 'documents']
      if (!entityId || ![...allowedStoreSections, ...legacyStoreSections].includes(section)) return json({ error: 'กรุณาระบุร้านค้าและหมวดข้อมูลที่ต้องการบันทึก' }, 400)
      const { data: existing, error: existingError } = await admin.from('stores').select('id,name').eq('id', entityId).maybeSingle()
      if (existingError) return json({ error: existingError.message }, 400)
      if (!existing) return json({ error: 'ไม่พบร้านค้าที่ต้องการแก้ไข' }, 404)
      const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key)
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

      if (section === 'general') {
        if (has('name')) { const name = text(input.name); if (!name) return json({ error: 'ชื่อร้านค้าห้ามว่าง' }, 400); updates.name = name }
        if (has('description')) updates.description = text(input.description)
        if (has('eta')) updates.eta = text(input.eta)
        if (has('rating')) updates.rating = Math.min(5, number(input.rating))
        if (has('settlement_gp_percent')) { const gp = number(input.settlement_gp_percent); if (!Number.isFinite(gp) || gp < 0 || gp > 100) return json({ error: 'GP ร้านค้าต้องอยู่ระหว่าง 0 ถึง 100' }, 400); updates.settlement_gp_percent = gp }
        if (has('phone')) { const phone = text(input.phone); if (!/^\+?[0-9][0-9\-\s()]{7,18}$/.test(phone)) return json({ error: 'รูปแบบเบอร์โทรติดต่อร้านไม่ถูกต้อง' }, 400); updates.phone = phone }
        if (has('category_id')) updates.category_id = text(input.category_id) || null
      }

      if (section === 'identity') {
        if (has('legal_name')) updates.legal_name = text(input.legal_name).slice(0, 160)
        if (has('registration_number')) updates.registration_number = text(input.registration_number).slice(0, 120)
        if (has('contact_name')) updates.contact_name = text(input.contact_name).slice(0, 160)
        if (has('contact_email')) { const email = normalizedId(input.contact_email); if (email && !looksLikeEmail(email)) return json({ error: 'รูปแบบอีเมลติดต่อร้านไม่ถูกต้อง' }, 400); updates.contact_email = email }
        if (has('phone')) { const phone = text(input.phone); if (!/^\+?[0-9][0-9\-\s()]{7,18}$/.test(phone)) return json({ error: 'รูปแบบเบอร์โทรติดต่อร้านไม่ถูกต้อง' }, 400); updates.phone = phone }
        if (has('category_id')) updates.category_id = text(input.category_id) || null
      }

      if (section === 'addresses') {
        for (const key of ['registered_address', 'pickup_address', 'delivery_address']) {
          if (has(key)) updates[key] = text(input[key]).slice(0, 800)
        }
        if (has('location')) updates.location = input.location || null
      }

      if (section === 'documents') {
        if (has('registration_document_url')) {
          const value = text(input.registration_document_url)
          if (value && !value.startsWith('store-documents/')) return json({ error: 'ตำแหน่งเอกสารร้านไม่ถูกต้อง' }, 400)
          updates.registration_document_url = value
        }
      }

      if (section === 'appearance') {
        if (has('emoji')) updates.emoji = text(input.emoji, '🍽️') || '🍽️'
        if (has('image_url')) updates.image_url = text(input.image_url) || null
        if (has('background_url')) updates.background_url = text(input.background_url) || null
      }

      if (section === 'operations') {
        if (has('open_time')) { const open = text(input.open_time); if (!/^\d{2}:\d{2}$/.test(open)) return json({ error: 'เวลาเปิดร้านไม่ถูกต้อง' }, 400); updates.open_time = open }
        if (has('close_time')) { const close = text(input.close_time); if (!/^\d{2}:\d{2}$/.test(close)) return json({ error: 'เวลาปิดร้านไม่ถูกต้อง' }, 400); updates.close_time = close }
        if (has('order_cutoff_minutes')) updates.order_cutoff_minutes = Math.min(240, Math.trunc(number(input.order_cutoff_minutes)))
        if (has('emergency_closed')) updates.emergency_closed = Boolean(input.emergency_closed)
        if (has('emergency_note')) updates.emergency_note = text(input.emergency_note) || null
        if (has('location')) updates.location = input.location || null
      }

      if (Object.keys(updates).length === 1) return json({ error: 'ไม่พบข้อมูลที่แก้ไขในหมวดนี้' }, 400)
      const { data: updated, error: updateError } = await admin.from('stores').update(updates).eq('id', entityId).select('id,name,emoji,description,rating,eta,phone,location,image_url,background_url,open_time,close_time,order_cutoff_minutes,emergency_closed,emergency_note,category_id,legal_name,registration_number,contact_name,contact_email,registered_address,pickup_address,delivery_address,registration_document_url,active,moderation_status,moderation_reason,moderation_changed_at').single()
      if (updateError) return json({ error: updateError.message }, 400)
      return json({ ok: true, entity_id: entityId, section, store: updated })
    }

    if (body.action === 'reset_rider_password') {
      const entityId = text(body.entity_id), password = String(body.password || '')
      if (!entityId || !secureTemporaryPassword(password)) return json({ error: 'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 12 ตัวอักษร และมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ โดยห้ามมีช่องว่าง' }, 400)
      const { data: rider, error: riderError } = await admin.from('riders').select('id,user_id').eq('id', entityId).maybeSingle()
      if (riderError) return json({ error: riderError.message }, 400)
      if (!rider?.user_id) return json({ error: 'Rider นี้ยังไม่ผูกบัญชี Rider App' }, 409)
      const { error: passwordError } = await admin.auth.admin.updateUserById(rider.user_id, { password })
      if (passwordError) return json({ error: passwordError.message }, 400)
      await admin.from('admin_action_audit').insert({ actor_id: caller.id, target_user_id: rider.user_id, action: 'rider_password_reset', after_state: { rider_id: entityId } })
      return json({ ok: true, entity_id: entityId })
    }

    if (body.action === 'reset_store_password') {
      const entityId = text(body.entity_id), password = String(body.password || '')
      if (!entityId || !secureTemporaryPassword(password)) return json({ error: 'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 12 ตัวอักษร และมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ โดยห้ามมีช่องว่าง' }, 400)
      const { data: store, error: storeError } = await admin.from('stores').select('id,owner_id').eq('id', entityId).maybeSingle()
      if (storeError) return json({ error: storeError.message }, 400)
      if (!store?.owner_id) return json({ error: 'ร้านนี้ยังไม่ผูกบัญชี Store App' }, 409)
      const { error: passwordError } = await admin.auth.admin.updateUserById(store.owner_id, { password })
      if (passwordError) return json({ error: passwordError.message }, 400)
      await admin.from('admin_action_audit').insert({ actor_id: caller.id, target_user_id: store.owner_id, action: 'store_password_reset', after_state: { store_id: entityId } })
      return json({ ok: true, entity_id: entityId })
    }

    if (body.action === 'get_store_moderation_events') {
      const entityId = text(body.entity_id)
      if (!entityId) return json({ error: 'กรุณาระบุร้านค้าที่ต้องการดูประวัติ' }, 400)
      const { data: events, error: eventsError } = await admin.from('store_moderation_events').select('id,action,reason,performed_by,created_at').eq('store_id', entityId).order('created_at', { ascending: false }).limit(30)
      if (eventsError) return json({ error: eventsError.message }, 400)
      return json({ ok: true, events: events || [] })
    }

    if (body.action === 'get_entity_account') {
      const role = body.role, entityId = text(body.entity_id)
      if (!isRole(role) || !entityId) return json({ error: 'กรุณาระบุประเภทบัญชีและรหัสข้อมูลที่ต้องการตรวจสอบ' }, 400)
      if (role === 'store_owner') {
        const { data: store, error: storeError } = await admin.from('stores').select('id,name,owner_id,owner_email,contact_email,phone').eq('id', entityId).maybeSingle()
        if (storeError) return json({ error: storeError.message }, 400)
        if (!store) return json({ error: 'ไม่พบร้านค้าที่ต้องการตรวจสอบ' }, 404)
        const { data: profile, error: profileError } = store.owner_id ? await admin.from('user_profiles').select('email,login_id,phone,display_name').eq('user_id', store.owner_id).maybeSingle() : { data: null, error: null }
        if (profileError) return json({ error: profileError.message }, 400)
        return json({ ok: true, role, entity_id: store.id, contact_email: store.contact_email || '', login_id: profile?.login_id || '', phone: profile?.phone || store.phone || '', display_name: profile?.display_name || store.name || '' })
      }
      const { data: rider, error: riderError } = await admin.from('riders').select('id,name,user_id,phone').eq('id', entityId).maybeSingle()
      if (riderError) return json({ error: riderError.message }, 400)
      if (!rider) return json({ error: 'ไม่พบ Rider ที่ต้องการตรวจสอบ' }, 404)
      const { data: profile, error: profileError } = rider.user_id ? await admin.from('user_profiles').select('email,login_id,phone,display_name').eq('user_id', rider.user_id).maybeSingle() : { data: null, error: null }
      if (profileError) return json({ error: profileError.message }, 400)
      return json({ ok: true, role, entity_id: rider.id, contact_email: '', login_id: profile?.login_id || '', phone: profile?.phone || rider.phone || '', display_name: profile?.display_name || rider.name || '' })
    }

    if (body.action === 'get_withdrawal_review_detail') {
      const requestId = text(body.request_id)
      if (!requestId) return json({ error: 'กรุณาระบุคำขอถอนเงินที่ต้องการตรวจสอบ' }, 400)
      const { data: withdrawal, error: withdrawalError } = await admin.from('withdrawal_requests').select('id,recipient_type,store_id,rider_id,recipient_name,amount,payout_snapshot,recipient_note,status,admin_note,proof_image_url,payment_reference,requested_at,reviewed_at,paid_at,proof_available').eq('id', requestId).maybeSingle()
      if (withdrawalError) return json({ error: withdrawalError.message }, 400)
      if (!withdrawal) return json({ error: 'ไม่พบคำขอถอนเงิน' }, 404)
      let recipient: Record<string, unknown> = { name: withdrawal.recipient_name || '', phone: '', address: '', user_id: '' }
      if (withdrawal.recipient_type === 'rider' && withdrawal.rider_id) {
        const { data: rider, error } = await admin.from('riders').select('id,user_id,name,phone').eq('id', withdrawal.rider_id).maybeSingle()
        if (error) return json({ error: error.message }, 400)
        if (rider) {
          const { data: profile } = rider.user_id ? await admin.from('user_profiles').select('display_name,phone,address,email').eq('user_id', rider.user_id).maybeSingle() : { data: null }
          recipient = { name: profile?.display_name || rider.name || withdrawal.recipient_name || '', phone: profile?.phone || rider.phone || '', address: profile?.address || '', email: profile?.email || '', user_id: rider.user_id || '' }
        }
      } else if (withdrawal.recipient_type === 'store' && withdrawal.store_id) {
        const { data: store, error } = await admin.from('stores').select('id,owner_id,name,phone,legal_name,contact_name,contact_email,registered_address,pickup_address').eq('id', withdrawal.store_id).maybeSingle()
        if (error) return json({ error: error.message }, 400)
        if (store) {
          const { data: profile } = store.owner_id ? await admin.from('user_profiles').select('display_name,phone,address,email').eq('user_id', store.owner_id).maybeSingle() : { data: null }
          recipient = { name: profile?.display_name || store.contact_name || store.legal_name || store.name || withdrawal.recipient_name || '', phone: profile?.phone || store.phone || '', address: profile?.address || store.pickup_address || store.registered_address || '', email: profile?.email || store.contact_email || '', user_id: store.owner_id || '', store_name: store.name || '' }
        }
      }
      return json({ ok: true, withdrawal, recipient })
    }

    if (body.action === 'list_user_control_plane') {
      const [{ data: profiles, error: profilesError }, { data: roles, error: rolesError }, { data: controls, error: controlsError }, { data: wallets, error: walletsError }, { data: canManageAdmin, error: governanceError }] = await Promise.all([

        admin.from('user_profiles').select('user_id,email,display_name,phone,address,login_id,created_at,updated_at').order('created_at', { ascending: false }).limit(1000),
        admin.from('user_roles').select('user_id,role').limit(4000),
        admin.from('account_controls').select('user_id,status,suspension_reason,feature_overrides,updated_at').limit(1000),
        admin.from('wallet_transactions').select('customer_id,amount,created_at').order('created_at', { ascending: false }).limit(5000),
        callerDb.rpc('admin_can_manage_admin_roles'),
      ])
      if (profilesError || rolesError || controlsError || walletsError) return json({ error: profilesError?.message || rolesError?.message || controlsError?.message || walletsError?.message || 'ไม่สามารถอ่านข้อมูลบัญชีได้' }, 400)
      if (governanceError) console.warn('admin governance capability unavailable', governanceError.message)

      const rolesByUser = new Map<string, string[]>(); (roles || []).forEach(row => rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) || []), row.role]))
      const controlsByUser = new Map((controls || []).map(row => [row.user_id, row]))
      const walletByUser = new Map<string, number>(); (wallets || []).forEach(row => walletByUser.set(row.customer_id, Number(walletByUser.get(row.customer_id) || 0) + Number(row.amount || 0)))
      return json({ ok: true, can_manage_admin: canManageAdmin === true, users: (profiles || []).map(profile => ({ ...profile, roles: rolesByUser.get(profile.user_id) || [], control: controlsByUser.get(profile.user_id) || { status: 'active', suspension_reason: '', feature_overrides: {} }, wallet_balance: walletByUser.get(profile.user_id) || 0 })) })
    }

    if (body.action === 'update_user_profile_section') {
      const userId = text(body.user_id), section = text(body.section), input = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>
      if (!userId || !['identity', 'contact', 'auth'].includes(section)) return json({ error: 'กรุณาระบุบัญชีและหมวดข้อมูลที่ต้องการบันทึก' }, 400)
      const { data: existing, error: existingError } = await admin.from('user_profiles').select('user_id,email,display_name,phone,address,login_id').eq('user_id', userId).maybeSingle()
      if (existingError || !existing) return json({ error: existingError?.message || 'ไม่พบบัญชีผู้ใช้' }, 404)
      const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key), updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (section === 'identity') {
        if (has('display_name')) { const value = text(input.display_name); if (!value) return json({ error: 'ชื่อต้องไม่ว่าง' }, 400); updates.display_name = value }
        if (has('login_id')) { const value = normalizedId(input.login_id); if (!loginIdIsValid(value)) return json({ error: 'Login ID ไม่ถูกต้อง' }, 400); const { data: duplicate } = await admin.from('user_profiles').select('user_id').eq('login_id', value).neq('user_id', userId).maybeSingle(); if (duplicate) return json({ error: 'Login ID นี้ถูกใช้งานแล้ว' }, 409); updates.login_id = value }
      }
      if (section === 'contact') { if (has('phone')) updates.phone = text(input.phone); if (has('address')) updates.address = text(input.address) }
      if (Object.keys(updates).length > 1) { const { error: updateError } = await admin.from('user_profiles').update(updates).eq('user_id', userId); if (updateError) return json({ error: updateError.message }, 400) }
      if (section === 'auth') {
        const authUpdates: { email?: string; password?: string } = {}
        if (has('email')) { const email = normalizedId(input.email); if (!looksLikeEmail(email)) return json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' }, 400); authUpdates.email = email }
        if (has('password') && String(input.password || '')) { const password = String(input.password); if (password.length < 8) return json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' }, 400); authUpdates.password = password }
        if (!Object.keys(authUpdates).length) return json({ error: 'ไม่พบข้อมูลยืนยันตัวตนที่ต้องการแก้ไข' }, 400)
        const { error: authError } = await admin.auth.admin.updateUserById(userId, authUpdates); if (authError) return json({ error: authError.message }, 400)
        if (authUpdates.email) { const { error: profileEmailError } = await admin.from('user_profiles').update({ email: authUpdates.email, updated_at: new Date().toISOString() }).eq('user_id', userId); if (profileEmailError) return json({ error: profileEmailError.message }, 400) }
      }
      const { data: refreshed } = await admin.from('user_profiles').select('user_id,email,display_name,phone,address,login_id,updated_at').eq('user_id', userId).single()
      await admin.from('admin_action_audit').insert({ actor_id: caller.id, target_user_id: userId, action: `user_profile_${section}_updated`, before_state: existing, after_state: refreshed || {} })
      return json({ ok: true, user: refreshed })
    }

    if (body.action === 'set_account_control') {
      const { data, error } = await callerDb.rpc('admin_set_account_control', { p_user_id: text(body.user_id), p_status: text(body.status, 'active'), p_feature_overrides: body.feature_overrides && typeof body.feature_overrides === 'object' ? body.feature_overrides : {}, p_reason: text(body.reason), p_evidence_path: text(body.evidence_path) || null })
      if (error) return json({ error: error.message }, 400); return json({ ok: true, control: data })
    }

    if (body.action === 'set_user_roles') {
      const roles = Array.isArray(body.roles) ? body.roles : []
      if (!roles.length || roles.some(role => !isManagedRole(role))) return json({ error: 'กรุณาเลือกบทบาทที่ระบบรองรับอย่างน้อยหนึ่งรายการ' }, 400)
      const { data, error } = await callerDb.rpc('admin_set_user_roles', { p_user_id: text(body.user_id), p_roles: roles, p_reason: text(body.reason), p_evidence_path: text(body.evidence_path) || null })
      if (error) return json({ error: error.message }, 400); return json({ ok: true, roles: data?.roles || [] })
    }

    if (body.action === 'adjust_customer_wallet') {
      const { data, error } = await callerDb.rpc('admin_adjust_customer_wallet', { p_customer_id: text(body.user_id), p_direction: text(body.direction), p_amount: Number(body.amount), p_reason: text(body.reason), p_evidence_path: text(body.evidence_path) || null })
      if (error) return json({ error: error.message }, 400); return json({ ok: true, wallet: data })
    }

    if (body.action === 'create_managed_account') {
      const role = body.role, contactEmail = normalizedId(body.email || body.contact_email), requestedLoginId = normalizedId(body.login_id), displayName = text(body.display_name), password = String(body.password || ''), phone = text(body.phone)
      const internalRole = role === 'admin' || role === 'rider' || role === 'store_owner'
      const loginId = internalRole ? requestedLoginId : ''
      const email = internalRole ? internalEmailFor(loginId) : contactEmail
      if (!isManagedRole(role) || (role === 'customer' && !looksLikeEmail(contactEmail)) || (internalRole && !loginIdIsValid(loginId)) || !displayName || password.length < 8) return json({ error: role === 'customer' ? 'บัญชี Customer ต้องใช้อีเมลที่ถูกต้อง ส่วนบัญชีภายในต้องมี Login ID ชื่อ และรหัสผ่านอย่างน้อย 8 ตัวอักษรให้ครบถ้วน' : 'กรุณาระบุบทบาท Login ID ชื่อ และรหัสผ่านอย่างน้อย 8 ตัวอักษรให้ครบถ้วน' }, 400)
      if (role === 'admin') {
        const { data: canManageAdmin, error: governanceError } = await callerDb.rpc('admin_can_manage_admin_roles')
        if (governanceError || canManageAdmin !== true) return json({ error: 'เฉพาะ Master/Owner เท่านั้นที่สร้างหรืออนุมัติบัญชีผู้ดูแลได้' }, 403)
      }
      const duplicateFilter = loginId ? `email.eq.${email},login_id.eq.${loginId}` : `email.eq.${email}`
      const { data: duplicate } = await admin.from('user_profiles').select('user_id').or(duplicateFilter).maybeSingle(); if (duplicate) return json({ error: 'อีเมลภายในหรือ Login ID นี้ถูกใช้งานแล้ว' }, 409)
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { ...(loginId ? { login_id: loginId } : {}), app_role: role, display_name: displayName, ...(looksLikeEmail(contactEmail) && role !== 'customer' ? { contact_email: contactEmail } : {}) } })
      if (createError || !created.user) return json({ error: createError?.message || 'ไม่สามารถสร้างบัญชีได้' }, 400)
      const userId = created.user.id
      const { error: profileError } = await admin.from('user_profiles').upsert({ user_id: userId, email, display_name: displayName, login_id: loginId || null, phone }); if (profileError) return json({ error: profileError.message }, 400)
      const { error: roleError } = await admin.from('user_roles').insert({ user_id: userId, role }); if (roleError) return json({ error: roleError.message }, 400)
      await admin.from('admin_action_audit').insert({ actor_id: caller.id, target_user_id: userId, action: 'managed_account_created', after_state: { role, login_id: loginId, has_contact_email: looksLikeEmail(contactEmail) } })
      return json({ ok: true, user_id: userId, role, login_id: loginId || null, contact_email: looksLikeEmail(contactEmail) ? contactEmail : null })
    }

    if (body.action === 'provision_store_owner') {
      const entity = body.entity && typeof body.entity === 'object' ? body.entity as Record<string, unknown> : {}
      const entityId = text(body.entity_id || entity.id), email = normalizedId(body.email), loginId = normalizedId(body.login_id), displayName = text(body.display_name), password = String(body.password || ''), phone = text(body.phone || entity.phone), storeName = text(entity.name)
      if (!entityId || !storeName || !looksLikeEmail(email) || !loginIdIsValid(loginId) || !displayName || !secureTemporaryPassword(password)) return json({ error: 'กรุณาระบุชื่อร้าน ชื่อเจ้าของ อีเมล Login ID และรหัสผ่านที่ปลอดภัยอย่างน้อย 12 ตัวอักษรให้ครบถ้วน' }, 400)
      const { data: duplicate } = await admin.from('user_profiles').select('user_id').or(`email.eq.${email},login_id.eq.${loginId}`).maybeSingle()
      if (duplicate) return json({ error: 'อีเมลหรือ Login ID นี้ถูกใช้งานแล้ว' }, 409)
      const { data: existingStore, error: existingStoreError } = await admin.from('stores').select('id').eq('id', entityId).maybeSingle()
      if (existingStoreError) return json({ error: existingStoreError.message }, 400)
      if (existingStore) return json({ error: 'รหัสร้านค้านี้ถูกใช้งานแล้ว กรุณาลองใหม่' }, 409)
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { login_id: loginId, app_role: 'store_owner', display_name: displayName } })
      if (createError || !created.user) return json({ error: createError?.message || 'ไม่สามารถสร้างบัญชี Merchant ได้' }, 400)
      const userId = created.user.id
      try {
        const { error: profileError } = await admin.from('user_profiles').upsert({ user_id: userId, email, display_name: displayName, login_id: loginId || null, phone })
        if (profileError) throw profileError
        const { error: roleError } = await admin.from('user_roles').insert({ user_id: userId, role: 'store_owner' })
        if (roleError) throw roleError
        const store = { id: entityId, owner_id: userId, owner_email: email, name: storeName, phone, active: entity.active !== false, moderation_status: text(entity.moderation_status, 'active'), legal_name: text(entity.legal_name) || null, registration_number: text(entity.registration_number) || null, contact_name: text(entity.contact_name) || null, contact_email: text(entity.contact_email) || null, registered_address: text(entity.registered_address) || null, pickup_address: text(entity.pickup_address) || null, delivery_address: text(entity.delivery_address) || null, category_id: text(entity.category_id) || null, location: entity.location || null, updated_at: new Date().toISOString() }
        const { error: storeError } = await admin.from('stores').insert(store)
        if (storeError) throw storeError
        await admin.from('admin_action_audit').insert({ actor_id: caller.id, target_user_id: userId, action: 'store_owner_provisioned', after_state: { store_id: entityId, login_id: loginId } })
        return json({ ok: true, entity_id: entityId, user_id: userId, login_id: loginId })
      } catch (error) {
        await admin.auth.admin.deleteUser(userId).catch(() => null)
        return json({ error: error instanceof Error ? error.message : 'ไม่สามารถสร้างร้านค้าและบัญชี Merchant ได้' }, 400)
      }
    }

    if (body.action === 'update_store_account_section') {
      const entityId = text(body.entity_id), input = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>
      if (!entityId) return json({ error: 'กรุณาระบุร้านค้าที่ต้องการจัดการบัญชี' }, 400)
      const { data: store, error: storeError } = await admin.from('stores').select('id,owner_id').eq('id', entityId).maybeSingle(); if (storeError || !store?.owner_id) return json({ error: storeError?.message || 'ร้านนี้ยังไม่ผูกบัญชี Merchant' }, 409)
      const userId = store.owner_id, has = (key: string) => Object.prototype.hasOwnProperty.call(input, key), authUpdates: { email?: string; password?: string } = {}, profileUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (has('email')) { const email = normalizedId(input.email); if (!looksLikeEmail(email)) return json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' }, 400); authUpdates.email = email; profileUpdates.email = email }
      if (has('login_id')) { const loginId = normalizedId(input.login_id); if (!loginIdIsValid(loginId)) return json({ error: 'Login ID ไม่ถูกต้อง' }, 400); const { data: duplicate } = await admin.from('user_profiles').select('user_id').eq('login_id', loginId).neq('user_id', userId).maybeSingle(); if (duplicate) return json({ error: 'Login ID นี้ถูกใช้งานแล้ว' }, 409); profileUpdates.login_id = loginId }
      if (has('display_name')) { const displayName = text(input.display_name); if (!displayName) return json({ error: 'ชื่อเจ้าของร้านห้ามว่าง' }, 400); profileUpdates.display_name = displayName }
      if (has('phone')) profileUpdates.phone = text(input.phone)
      let contactEmail: string | null = null
      if (has('contact_email')) { contactEmail = normalizedId(input.contact_email); if (contactEmail && !looksLikeEmail(contactEmail)) return json({ error: 'รูปแบบอีเมลติดต่อร้านไม่ถูกต้อง' }, 400) }
      if (has('password') && String(input.password || '')) { const password = String(input.password); if (!secureTemporaryPassword(password)) return json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 12 ตัวอักษร และมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ โดยห้ามมีช่องว่าง' }, 400); authUpdates.password = password }
      if (!Object.keys(authUpdates).length && Object.keys(profileUpdates).length === 1 && !has('contact_email')) return json({ error: 'ไม่พบข้อมูลบัญชีที่แก้ไข' }, 400)
      if (Object.keys(authUpdates).length) { const { error: authError } = await admin.auth.admin.updateUserById(userId, authUpdates); if (authError) return json({ error: authError.message }, 400) }
      if (Object.keys(profileUpdates).length > 1) { const { error: profileError } = await admin.from('user_profiles').update(profileUpdates).eq('user_id', userId); if (profileError) return json({ error: profileError.message }, 400) }
      if (authUpdates.email) await admin.from('stores').update({ owner_email: authUpdates.email, updated_at: new Date().toISOString() }).eq('id', entityId)
      if (has('contact_email')) { const { error: contactError } = await admin.from('stores').update({ contact_email: contactEmail, updated_at: new Date().toISOString() }).eq('id', entityId); if (contactError) return json({ error: contactError.message }, 400) }
      await admin.from('admin_action_audit').insert({ actor_id: caller.id, target_user_id: userId, action: 'store_account_updated', after_state: { store_id: entityId, fields: Object.keys(input) } })
      return json({ ok: true, entity_id: entityId })
    }

    if (body.action === 'resolve_order_cancellation') {
      const requestId = text(body.request_id)
      const decision = text(body.decision)
      const reason = text(body.reason)
      const refundDecision = text(body.refund_decision, 'no_refund')
      const idempotencyKey = text(body.idempotency_key)
      if (!requestId || !['approve', 'reject'].includes(decision) || reason.length < 10 || !idempotencyKey) return json({ error: 'กรุณาระบุคำขอ ผลพิจารณา และเหตุผลอย่างน้อย 10 ตัวอักษรให้ครบถ้วน' }, 400)
      const { data, error } = await callerDb.rpc('admin_resolve_order_cancellation', { p_request_id: requestId, p_action: decision, p_resolution_reason: reason, p_refund_decision: refundDecision, p_idempotency_key: idempotencyKey, p_evidence_path: text(body.evidence_path) || null })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, cancellation: data })
    }

    if (body.action === 'support_conversation') {
      const conversationId = text(body.conversation_id)
      const supportAction = text(body.support_action)
      const message = text(body.body)
      const idempotencyKey = text(body.idempotency_key)
      if (!conversationId || !['reply', 'close', 'reopen'].includes(supportAction) || !idempotencyKey) return json({ error: 'กรุณาระบุบทสนทนา คำสั่ง และรหัสยืนยันให้ครบถ้วน' }, 400)
      if (supportAction === 'reply' && (message.length < 1 || message.length > 1500)) return json({ error: 'ข้อความตอบกลับต้องมีความยาว 1–1500 ตัวอักษร' }, 400)
      if (supportAction !== 'reply' && (message.length < 3 || message.length > 500)) return json({ error: 'เหตุผลการเปลี่ยนสถานะต้องมีความยาว 3–500 ตัวอักษร' }, 400)
      const { data: existing, error: conversationError } = await admin.from('support_conversations').select('id,customer_id,customer_name,status').eq('id', conversationId).maybeSingle()
      if (conversationError) return json({ error: conversationError.message }, 400)
      if (!existing) return json({ error: 'ไม่พบบทสนทนาศูนย์ช่วยเหลือ' }, 404)
      const { data: replayAudit, error: replayAuditError } = await admin.from('admin_action_audit').select('id').eq('target_id', conversationId).eq('action', `support_${supportAction}`).eq('metadata->>idempotency_key', idempotencyKey).maybeSingle()
      if (replayAuditError) return json({ error: replayAuditError.message }, 400)
      if (replayAudit) return json({ ok: true, conversation_id: conversationId, status: existing.status, replayed: true })
      const now = new Date().toISOString()
      if (supportAction === 'reply') {
        const { error: messageError } = await admin.from('support_messages').insert({ conversation_id: conversationId, sender_id: caller.id, sender_role: 'admin', body: message, created_at: now })
        if (messageError) return json({ error: messageError.message }, 400)
      }
      const nextStatus = supportAction === 'close' ? 'closed' : 'open'
      const { data: updated, error: updateError } = await admin.from('support_conversations').update({ status: nextStatus, last_message_at: now }).eq('id', conversationId).select('id,customer_id,customer_name,status,last_message_at').single()
      if (updateError) return json({ error: updateError.message }, 400)
      await admin.from('admin_action_audit').insert({ actor_id: caller.id, target_user_id: existing.customer_id || null, target_type: 'support_conversation', target_id: conversationId, action: `support_${supportAction}`, reason: message, before_state: existing, after_state: updated, metadata: { idempotency_key: idempotencyKey } })
      if (supportAction === 'reply' || supportAction === 'close') {
        await admin.from('mobile_notifications').insert({ recipient_id: existing.customer_id, recipient_role: 'customer', title: supportAction === 'reply' ? 'มีข้อความใหม่จากศูนย์ช่วยเหลือ' : 'บทสนทนาศูนย์ช่วยเหลือถูกปิดแล้ว', body: supportAction === 'reply' ? message.slice(0, 240) : 'หากต้องการความช่วยเหลือเพิ่มเติม สามารถเปิดบทสนทนาใหม่ได้จากศูนย์ช่วยเหลือ', data: { conversation_id: conversationId, deep_link: 'support.html' }, status: 'sent', created_at: now, sent_at: now })
      }
      return json({ ok: true, conversation: updated, replayed: false })
    }

    if (body.action === 'process_order_refund') {
      const refundId = text(body.refund_id)
      const action = text(body.refund_action)
      const reason = text(body.reason)
      const idempotencyKey = text(body.idempotency_key)
      const approvedAmount = body.approved_amount === null || body.approved_amount === undefined || body.approved_amount === '' ? null : Number(body.approved_amount)
      const paidAmount = body.paid_amount === null || body.paid_amount === undefined || body.paid_amount === '' ? null : Number(body.paid_amount)
      if (!refundId || !['approve', 'reject', 'mark_paid'].includes(action) || reason.length < 10 || !idempotencyKey) return json({ error: 'กรุณาระบุคำขอคืนเงิน คำสั่ง เหตุผลอย่างน้อย 10 ตัวอักษร และรหัสยืนยันให้ครบถ้วน' }, 400)
      if (approvedAmount !== null && !Number.isFinite(approvedAmount)) return json({ error: 'ยอดอนุมัติคืนเงินไม่ถูกต้อง' }, 400)
      if (paidAmount !== null && !Number.isFinite(paidAmount)) return json({ error: 'ยอดโอนคืนไม่ถูกต้อง' }, 400)
      const { data, error } = await callerDb.rpc('admin_process_order_refund', {
        p_refund_id: refundId,
        p_action: action,
        p_approved_amount: approvedAmount,
        p_paid_amount: paidAmount,
        p_payment_reference: text(body.payment_reference) || null,
        p_proof_image_url: text(body.proof_image_url) || null,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
      })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, refund: data })
    }

    if (body.action === 'manage_delivery_order') {
      const orderId = text(body.order_id)
      const operation = text(body.operation)
      const reason = text(body.reason)
      const evidencePath = text(body.evidence_path)
      const input = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>
      if (!orderId || !['status', 'assign_rider', 'dispatch', 'items'].includes(operation)) return json({ error: 'กรุณาระบุออร์เดอร์และคำสั่งจัดการที่ถูกต้อง' }, 400)
      if (reason.length < 10) return json({ error: 'กรุณาระบุเหตุผลการจัดการอย่างน้อย 10 ตัวอักษร' }, 400)
      if (evidencePath && !evidencePath.startsWith(`admin-override-evidence/${caller.id}/override/`)) return json({ error: 'หลักฐานต้องเป็นไฟล์ private ของ Admin ผู้ดำเนินการเท่านั้น' }, 400)
      const idempotencyKey = text(body.idempotency_key)
      if (['assign_rider', 'dispatch'].includes(operation) && idempotencyKey.length < 12) return json({ error: 'รหัสยืนยัน Dispatch ไม่ถูกต้อง' }, 400)
      const { data: order, error: orderError } = await admin.from('delivery_orders').select('id,customer_id,status,total,payable,delivery_fee,credit_used,rider_id,rider_name,accepted_at,delivery_started_at,completed_at,dispatch_status,assigned_at,estimated_arrival_at,eta_source,dispatch_note,dispatch_updated_at').eq('id', orderId).maybeSingle()
      if (orderError) return json({ error: orderError.message }, 400)
      if (!order) return json({ error: 'ไม่พบออร์เดอร์ที่ต้องการจัดการ' }, 404)
      const now = new Date().toISOString()
      if (['assign_rider', 'dispatch'].includes(operation)) {
        const { data: replayEvent, error: replayError } = await admin.from('delivery_dispatch_events').select('id,order_id,dispatch_status,estimated_arrival_at').eq('order_id', orderId).eq('idempotency_key', idempotencyKey).maybeSingle()
        if (replayError) return json({ error: replayError.message }, 400)
        if (replayEvent) return json({ ok: true, operation, order: { id: orderId, dispatch_status: replayEvent.dispatch_status, estimated_arrival_at: replayEvent.estimated_arrival_at }, replayed: true })
      }
      const writeAudit = async (action: string, beforeState: Record<string, unknown>, afterState: Record<string, unknown>) => {
        const { error } = await admin.from('admin_action_audit').insert({ actor_id: caller.id, target_user_id: order.customer_id || null, target_type: 'order', target_id: orderId, action, reason, evidence_path: evidencePath || null, before_state: beforeState, after_state: afterState, metadata: { override: true, operation } })
        if (error) throw new Error(`บันทึกประวัติผู้ดูแลไม่สำเร็จ: ${error.message}`)
      }

      if (operation === 'status') {
        const nextStatus = text(input.status)
        if (!nextStatus || !(ORDER_TRANSITIONS[String(order.status)] || []).includes(nextStatus)) return json({ error: `ไม่อนุญาตให้เปลี่ยนจาก “${text(order.status)}” เป็น “${nextStatus}”` }, 409)
        const updates: Record<string, unknown> = { status: nextStatus, updated_at: now }
        if (nextStatus === ORDER_STATUS.STORE_ACCEPTED && !order.accepted_at) updates.accepted_at = now
        if (nextStatus === ORDER_STATUS.DELIVERING && !order.delivery_started_at) updates.delivery_started_at = now
        if (nextStatus === ORDER_STATUS.COMPLETED && !order.completed_at) updates.completed_at = now
        const { data: updated, error: updateError } = await admin.from('delivery_orders').update(updates).eq('id', orderId).select('id,status,accepted_at,delivery_started_at,completed_at,updated_at').single()
        if (updateError) return json({ error: updateError.message }, 400)
        const { error: eventError } = await admin.from('order_status_events').insert({ order_id: orderId, status: nextStatus, actor_id: caller.id, actor_label: 'Admin', created_at: now })
        if (eventError) return json({ error: `บันทึกประวัติสถานะไม่สำเร็จ: ${eventError.message}` }, 400)
        await writeAudit('order_status_updated', { order_id: orderId, status: order.status }, { order_id: orderId, status: nextStatus })
        return json({ ok: true, operation, order: updated })
      }

      if (operation === 'assign_rider') {
        if (TERMINAL_ORDER_STATUSES.has(String(order.status))) return json({ error: 'ออร์เดอร์ที่ปิดงานแล้วไม่สามารถเปลี่ยน Rider ได้' }, 409)
        const riderId = text(input.rider_id) || null
        const { data: updated, error: updateError } = await callerDb.rpc('admin_update_order_dispatch', {
          p_order_id: orderId,
          p_dispatch_status: riderId ? 'assigned' : 'unassigned',
          p_rider_id: riderId,
          p_eta_minutes: null,
          p_update_eta: false,
          p_dispatch_note: '',
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
        })
        if (updateError) return json({ error: updateError.message }, 400)
        return json({ ok: true, operation, order: updated, replayed: Boolean(updated?.replayed) })
      }

      if (operation === 'dispatch') {
        if (TERMINAL_ORDER_STATUSES.has(String(order.status))) return json({ error: 'ออร์เดอร์ที่ปิดงานแล้วไม่สามารถแก้ Dispatch/ETA ได้' }, 409)
        const dispatchStatus = text(input.dispatch_status)
        const riderId = text(input.rider_id) || order.rider_id || null
        const updateEta = input.update_eta === true
        const etaMinutes = input.eta_minutes === null || input.eta_minutes === undefined || input.eta_minutes === '' ? null : Number(input.eta_minutes)
        const dispatchNote = text(input.dispatch_note)
        if (!['unassigned', 'assigned', 'en_route', 'arrived_pickup', 'picked_up', 'delivering', 'delivered', 'exception'].includes(dispatchStatus)) return json({ error: 'สถานะ Dispatch ไม่ถูกต้อง' }, 400)
        if (updateEta && etaMinutes !== null && (!Number.isInteger(etaMinutes) || etaMinutes < 0 || etaMinutes > 1440)) return json({ error: 'ETA ต้องเป็นจำนวนเต็ม 0–1440 นาที' }, 400)
        if (dispatchNote.length > 500) return json({ error: 'หมายเหตุ Dispatch ยาวเกิน 500 ตัวอักษร' }, 400)
        const { data: updated, error: updateError } = await callerDb.rpc('admin_update_order_dispatch', {
          p_order_id: orderId,
          p_dispatch_status: dispatchStatus,
          p_rider_id: riderId,
          p_eta_minutes: etaMinutes,
          p_update_eta: updateEta,
          p_dispatch_note: dispatchNote,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
        })
        if (updateError) return json({ error: updateError.message }, 400)
        return json({ ok: true, operation, order: updated, replayed: Boolean(updated?.replayed) })
      }

      if (operation !== 'items') return json({ error: 'คำสั่งจัดการออร์เดอร์นี้ไม่รองรับ' }, 400)
      if (!EDITABLE_ORDER_STATUSES.has(String(order.status))) return json({ error: 'แก้ไขรายการได้ก่อนเข้าสู่ขั้นรับสินค้าเท่านั้น' }, 409)
      const submitted = Array.isArray(input.items) ? input.items.slice(0, 60) as OrderItemInput[] : []
      if (!submitted.length) return json({ error: 'ออร์เดอร์ต้องมีรายการอย่างน้อยหนึ่งรายการ' }, 400)
      const { data: existingRows, error: itemsError } = await admin.from('delivery_order_items').select('id,order_id,item_id,name,emoji,unit_price,quantity,options').eq('order_id', orderId).order('id', { ascending: true })
      if (itemsError) return json({ error: itemsError.message }, 400)
      const existingById = new Map((existingRows || []).map(row => [String(row.id), row]))
      const seenIds = new Set<string>()
      const items = submitted.map((row, index) => {
        const id = text(row.id)
        if (id && (!existingById.has(id) || seenIds.has(id))) throw new Error('พบรายการออร์เดอร์ที่อ้างอิงไม่ถูกต้องหรือซ้ำ')
        if (id) seenIds.add(id)
        const name = text(row.name)
        const unitPrice = Number(row.unit_price)
        const quantity = Number(row.quantity)
        if (!name || name.length > 160 || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000 || !Number.isInteger(quantity) || quantity < 1 || quantity > 200) throw new Error(`ข้อมูลรายการที่ ${index + 1} ไม่ถูกต้อง`)
        return { id: id || null, order_id: orderId, item_id: text(row.item_id) || null, name, emoji: text(row.emoji, '🍽️').slice(0, 12) || '🍽️', unit_price: unitPrice, quantity, options: row.options && typeof row.options === 'object' ? row.options : {} }
      })
      const subtotal = items.reduce((sum, row) => sum + Number(row.unit_price) * Number(row.quantity), 0)
      const deliveryFee = Math.max(0, Number(order.delivery_fee || 0))
      const creditUsed = Math.min(Math.max(0, Number(order.credit_used || 0)), subtotal + deliveryFee)
      const total = subtotal + deliveryFee
      const payable = Math.max(0, total - creditUsed)
      for (const row of items) {
        const payload = { order_id: row.order_id, item_id: row.item_id, name: row.name, emoji: row.emoji, unit_price: row.unit_price, quantity: row.quantity, options: row.options }
        const { error } = row.id ? await admin.from('delivery_order_items').update(payload).eq('id', row.id).eq('order_id', orderId) : await admin.from('delivery_order_items').insert(payload)
        if (error) return json({ error: error.message }, 400)
      }
      const removedIds = (existingRows || []).map(row => String(row.id)).filter(id => !seenIds.has(id))
      if (removedIds.length) { const { error } = await admin.from('delivery_order_items').delete().eq('order_id', orderId).in('id', removedIds); if (error) return json({ error: error.message }, 400) }
      const { data: updated, error: updateError } = await admin.from('delivery_orders').update({ total, credit_used: creditUsed, payable, updated_at: now }).eq('id', orderId).select('id,total,credit_used,payable,updated_at').single()
      if (updateError) return json({ error: updateError.message }, 400)
      await writeAudit('order_items_updated', { order_id: orderId, total: order.total, payable: order.payable, item_count: (existingRows || []).length }, { order_id: orderId, total, payable, item_count: items.length })
      return json({ ok: true, operation, order: updated, item_count: items.length })
    }

    if (body.action !== 'provision') return json({ error: 'Unsupported action' }, 400)
    const role = body.role, entityId = text(body.entity_id), contactEmail = normalizedId(body.email || body.contact_email), loginId = normalizedId(body.login_id), displayName = text(body.display_name), password = String(body.password || ''), entity = (body.entity || {}) as RiderEntity | StoreEntity, phone = text(body.phone || (body.entity as Record<string, unknown> | undefined)?.phone)
    const email = internalEmailFor(loginId)
    const missing = [
      !isRole(role) ? 'ประเภทบัญชี' : '',
      !entityId ? 'รหัสข้อมูลร้านค้า/Rider' : '',
      !loginIdIsValid(loginId) ? 'Login ID (ภาษาอังกฤษ/ตัวเลข/จุด/ขีด ความยาว 3–32 ตัว และขึ้นต้นด้วยตัวอักษรหรือตัวเลข)' : '',
      !displayName ? 'ชื่อร้านค้าหรือชื่อ Rider' : '',
      role === 'store_owner' && !/^\+?[0-9][0-9\-\s()]{7,18}$/.test(phone) ? 'เบอร์โทรติดต่อร้านค้า' : '',
    ].filter(Boolean)
    if (missing.length) return json({ error: `กรุณาตรวจข้อมูลบัญชี: ${missing.join(', ')}` }, 400)
    const payloadEntityId = normalizedId(entity?.id)
    if (payloadEntityId && payloadEntityId !== normalizedId(entityId)) return json({ error: 'รหัสข้อมูลร้านค้า/Rider ไม่ตรงกับข้อมูลที่ส่งมา' }, 400)
    const reuseCallerAsStoreOwner = role === 'store_owner' && email === normalizedId(caller.email)
    if (email === normalizedId(caller.email) && !reuseCallerAsStoreOwner) return json({ error: 'ห้ามใช้อีเมลบัญชีแอดมินซ้ำเป็นบัญชี Rider กรุณาใช้อีเมลของผู้ปฏิบัติงานแต่ละคน' }, 400)
    const entityResult = role === 'rider' ? await admin.from('riders').select('id,user_id').eq('id', entityId).maybeSingle() : await admin.from('stores').select('id,owner_id').eq('id', entityId).maybeSingle()
    if (entityResult.error) return json({ error: entityResult.error.message }, 400)
    let userId = role === 'rider' ? entityResult.data?.user_id : entityResult.data?.owner_id
    if (reuseCallerAsStoreOwner && userId && userId !== caller.id) return json({ error: 'ร้านนี้ผูกกับบัญชีเจ้าของร้านอื่นอยู่แล้ว จึงไม่สามารถเปลี่ยนมาใช้บัญชีผู้ดูแลนี้ได้' }, 409)
    if (reuseCallerAsStoreOwner && !userId) userId = caller.id
    if (userId && !reuseCallerAsStoreOwner) {
      const updates: { email?: string; password?: string; user_metadata?: Record<string, string> } = { email, user_metadata: { login_id: loginId, app_role: role, display_name: displayName } }
      if (password) { if (password.length < 8) return json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' }, 400); updates.password = password }
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, updates); if (updateError) return json({ error: updateError.message }, 400)
    } else {
      if (password.length < 8) return json({ error: 'กำหนดรหัสผ่านอย่างน้อย 8 ตัวอักษรสำหรับบัญชีใหม่' }, 400)
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { login_id: loginId, app_role: role, display_name: displayName, ...(looksLikeEmail(contactEmail) ? { contact_email: contactEmail } : {}) } })
      if (createError || !created.user) return json({ error: createError?.message || 'ไม่สามารถสร้างบัญชีได้' }, 400); userId = created.user.id
    }
    const profilePayload = reuseCallerAsStoreOwner ? { user_id: userId, email } : { user_id: userId, email, display_name: displayName, login_id: loginId, ...(phone ? { phone } : {}) }
    const { error: profileError } = await admin.from('user_profiles').upsert(profilePayload, { onConflict: 'user_id' }); if (profileError) return json({ error: profileError.message }, 400)
    const { error: roleError } = await admin.from('user_roles').upsert({ user_id: userId, role }, { onConflict: 'user_id,role' }); if (roleError) return json({ error: roleError.message }, 400)
    if (role === 'rider') {
      const rider = entity as RiderEntity; if (!rider.name?.trim()) return json({ error: 'กรุณาระบุชื่อ Rider' }, 400)
      const { error: riderError } = await admin.from('riders').upsert({ id: entityId, user_id: userId, name: rider.name.trim(), emoji: rider.emoji || '🛵', phone: rider.phone || '', vehicle: rider.vehicle || 'มอเตอร์ไซค์', status: rider.status || 'พร้อมรับงาน', last_location: rider.lastLocation || null }, { onConflict: 'id' }); if (riderError) return json({ error: riderError.message }, 400)
    } else {
      const store = entity as StoreEntity; if (!store.name?.trim()) return json({ error: 'กรุณาระบุชื่อร้านค้า' }, 400)
      const { error: storeError } = await admin.from('stores').upsert({ id: entityId, owner_id: userId, name: store.name.trim(), emoji: store.emoji || '🍽️', description: store.desc || '', rating: Number(store.rating || 0), eta: store.eta || '', phone: store.phone || phone, location: store.location || null, active: store.active !== false, legal_name: text(store.legal_name).slice(0, 160), registration_number: text(store.registration_number).slice(0, 120), contact_name: text(store.contact_name).slice(0, 160), registered_address: text(store.registered_address).slice(0, 800), pickup_address: text(store.pickup_address).slice(0, 800), delivery_address: text(store.delivery_address).slice(0, 800), registration_document_url: text(store.registration_document_url), category_id: text(store.category_id) || null, contact_email: looksLikeEmail(text(store.contact_email || contactEmail)) ? normalizedId(store.contact_email || contactEmail) : null }, { onConflict: 'id' }); if (storeError) return json({ error: storeError.message }, 400)
    }
    return json({ ok: true, user_id: userId, login_id: loginId, contact_email: looksLikeEmail(contactEmail) ? contactEmail : null, entity_id: entityId, role })
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500) }
})
