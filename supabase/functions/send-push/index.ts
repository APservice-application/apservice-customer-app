// send-push: mobile_notifications insert -> FCM v1 send to user's web tokens.
// Auth: x-push-secret header must match PUSH_TRIGGER_SECRET (function has no JWT verify;
// the DB trigger reads the secret from vault). Service account comes from
// FIREBASE_SERVICE_ACCOUNT env (JSON). No secrets live in this file.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-push-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders })

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const textEncode = (s: string) => new TextEncoder().encode(s)

async function googleAccessToken(sa: { client_email: string; private_key: string; token_uri: string }) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(textEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claim = b64url(textEncode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  })))
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '')
  const raw = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', raw, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, textEncode(`${header}.${claim}`)))
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${claim}.${b64url(sig)}`,
  })
  if (!res.ok) throw new Error(`google oauth failed: ${res.status}`)
  const body = await res.json()
  if (!body.access_token) throw new Error('google oauth returned no token')
  return body.access_token as string
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const expected = Deno.env.get('PUSH_TRIGGER_SECRET') || ''
  if (!expected || req.headers.get('x-push-secret') !== expected) {
    return json({ error: 'unauthorized' }, 401)
  }
  let payload: { notification_id?: string } = {}
  try { payload = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  if (!payload.notification_id) return json({ error: 'notification_id required' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
  const { data: note, error: noteErr } = await supabase
    .from('mobile_notifications')
    .select('id, recipient_id, title, body, data')
    .eq('id', payload.notification_id)
    .maybeSingle()
  if (noteErr || !note) return json({ error: 'notification not found' }, 404)

  const { data: tokens, error: tokErr } = await supabase
    .from('push_device_tokens')
    .select('id, token, app')
    .eq('user_id', note.recipient_id)
  if (tokErr) return json({ error: 'token lookup failed' }, 500)
  if (!tokens?.length) return json({ ok: true, sent: 0, skipped: 'no tokens' })

  let sa: { project_id: string; client_email: string; private_key: string; token_uri: string }
  try { sa = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || '') } catch {
    return json({ error: 'bad service account secret' }, 500)
  }
  let access: string
  try { access = await googleAccessToken(sa) } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }

  const data = (note.data || {}) as Record<string, unknown>
  const deepLink = typeof data.deep_link === 'string' ? data.deep_link : ''
  const stringData: Record<string, string> = { url: deepLink }
  for (const key of ['order_id', 'orderId', 'type', 'kind']) {
    if (data[key] != null) stringData[key] = String(data[key])
  }
  const results: Array<{ token_id: string; ok: boolean; error?: string }> = []
  await Promise.all(tokens.map(async row => {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: row.token,
            notification: { title: String(note.title || 'AP Service'), body: String(note.body || 'มีการแจ้งเตือนใหม่') },
            data: stringData,
          },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) { results.push({ token_id: row.id, ok: true }); return }
      const err = String(body?.error?.status || body?.error?.message || res.status)
      results.push({ token_id: row.id, ok: false, error: err })
      if (/NOT_FOUND|UNREGISTERED|INVALID_ARGUMENT/i.test(JSON.stringify(body))) {
        await supabase.from('push_device_tokens').delete().eq('id', row.id)
      }
    } catch (e) {
      results.push({ token_id: row.id, ok: false, error: String(e?.message || e) })
    }
  }))
  const sent = results.filter(r => r.ok).length
  return json({ ok: true, sent, failed: results.length - sent, results })
})
