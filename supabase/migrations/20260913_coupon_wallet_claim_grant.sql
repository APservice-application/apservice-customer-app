-- Coupon wallet + claim + auto-grant + merchant requests, extended from 20260830000000_coupon_management.
-- Existing tables/columns/data are preserved; checkout group v3 gains optional per-store coupons.

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'platform' CHECK (owner_type IN ('platform', 'store')),
  ADD COLUMN IF NOT EXISTS owner_store_id text REFERENCES public.stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS distribution_type text NOT NULL DEFAULT 'claim' CHECK (distribution_type IN ('claim', 'auto_grant')),
  ADD COLUMN IF NOT EXISTS max_discount_amount numeric(12,2) CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'disabled')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_grant_rule jsonb NOT NULL DEFAULT '{"type":"all"}'::jsonb;

-- Backfill pre-existing rows only: fresh defaults give status='active' even when the
-- legacy toggle is off; align those once. Rows already consistent are untouched,
-- so re-running this migration never clobbers admin-set statuses.
UPDATE public.coupons SET status = 'disabled' WHERE active = false AND status = 'active';

CREATE OR REPLACE FUNCTION public.sync_coupon_active_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.active IS DISTINCT FROM OLD.active THEN
    NEW.status := CASE WHEN NEW.active THEN 'active' ELSE 'disabled' END;
  ELSE
    NEW.active := (NEW.status = 'active');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_coupon_active_status_after_change ON public.coupons;
CREATE TRIGGER sync_coupon_active_status_after_change
  BEFORE INSERT OR UPDATE OF status, active ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.sync_coupon_active_status();

CREATE TABLE IF NOT EXISTS public.customer_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'used', 'expired', 'revoked')),
  order_id text REFERENCES public.delivery_orders(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS customer_coupons_customer_idx ON public.customer_coupons(customer_id, status, claimed_at DESC);
CREATE INDEX IF NOT EXISTS customer_coupons_coupon_idx ON public.customer_coupons(coupon_id, status);

CREATE TABLE IF NOT EXISTS public.merchant_coupon_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric(12,2) NOT NULL CHECK (discount_value > 0),
  min_order_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  per_customer_limit integer NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (discount_type <> 'percent' OR discount_value <= 100)
);
CREATE INDEX IF NOT EXISTS merchant_coupon_requests_store_idx ON public.merchant_coupon_requests(store_id, status, created_at DESC);

CREATE OR REPLACE VIEW public.coupon_stats AS
SELECT c.id AS coupon_id, c.code, c.name,
  (SELECT count(*) FROM public.customer_coupons w WHERE w.coupon_id = c.id AND w.status <> 'revoked') AS claimed,
  (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id = c.id) AS used,
  (SELECT count(DISTINCT w.customer_id) FROM public.customer_coupons w WHERE w.coupon_id = c.id AND w.status <> 'revoked') AS customers,
  CASE WHEN c.max_redemptions IS NULL THEN NULL ELSE greatest(c.max_redemptions - (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id = c.id), 0) END AS remaining
FROM public.coupons c;

ALTER TABLE public.customer_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_coupon_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_coupons_owner_read ON public.customer_coupons;
CREATE POLICY customer_coupons_owner_read ON public.customer_coupons
  FOR SELECT TO authenticated USING (customer_id = auth.uid() OR private.has_role('admin'));
DROP POLICY IF EXISTS customer_coupons_admin_all ON public.customer_coupons;
CREATE POLICY customer_coupons_admin_all ON public.customer_coupons
  FOR ALL TO authenticated USING (private.has_role('admin')) WITH CHECK (private.has_role('admin'));

DROP POLICY IF EXISTS merchant_coupon_requests_owner_read ON public.merchant_coupon_requests;
CREATE POLICY merchant_coupon_requests_owner_read ON public.merchant_coupon_requests
  FOR SELECT TO authenticated USING (private.has_role('admin') OR store_id IN (SELECT id FROM public.stores WHERE owner_id = auth.uid()));
DROP POLICY IF EXISTS merchant_coupon_requests_owner_insert ON public.merchant_coupon_requests;
CREATE POLICY merchant_coupon_requests_owner_insert ON public.merchant_coupon_requests
  FOR INSERT TO authenticated WITH CHECK (store_id IN (SELECT id FROM public.stores WHERE owner_id = auth.uid()) AND status = 'pending');
DROP POLICY IF EXISTS merchant_coupon_requests_owner_update ON public.merchant_coupon_requests;
CREATE POLICY merchant_coupon_requests_owner_update ON public.merchant_coupon_requests
  FOR UPDATE TO authenticated USING (store_id IN (SELECT id FROM public.stores WHERE owner_id = auth.uid()) AND status = 'pending') WITH CHECK (store_id IN (SELECT id FROM public.stores WHERE owner_id = auth.uid()));
DROP POLICY IF EXISTS merchant_coupon_requests_admin_all ON public.merchant_coupon_requests;
CREATE POLICY merchant_coupon_requests_admin_all ON public.merchant_coupon_requests
  FOR ALL TO authenticated USING (private.has_role('admin')) WITH CHECK (private.has_role('admin'));

DROP POLICY IF EXISTS coupons_merchant_read_own ON public.coupons;
CREATE POLICY coupons_merchant_read_own ON public.coupons
  FOR SELECT TO authenticated USING (
    owner_store_id IN (SELECT id FROM public.stores WHERE owner_id = auth.uid())
    OR id IN (SELECT coupon_id FROM public.coupon_stores WHERE store_id IN (SELECT id FROM public.stores WHERE owner_id = auth.uid()))
  );

CREATE OR REPLACE FUNCTION public.claim_customer_coupon(p_coupon_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
DECLARE v_customer_id uuid := auth.uid(); v_coupon public.coupons; v_held integer; v_live integer; v_wallet_id uuid;
BEGIN
  IF v_customer_id IS NULL OR NOT private.has_role('customer') THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบด้วยบัญชีลูกค้าก่อนรับคูปอง'; END IF;
  IF p_coupon_id IS NULL THEN RAISE EXCEPTION 'ไม่พบคูปองที่ต้องการรับ'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('coupon-claim:' || p_coupon_id::text || ':' || v_customer_id::text));
  SELECT * INTO v_coupon FROM public.coupons WHERE id = p_coupon_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบคูปองที่ต้องการรับ'; END IF;
  IF NOT v_coupon.active THEN RAISE EXCEPTION 'คูปองนี้ถูกปิดใช้งานแล้ว'; END IF;
  IF v_coupon.starts_at > now() THEN RAISE EXCEPTION 'คูปองนี้ยังไม่ถึงเวลาใช้งาน'; END IF;
  IF v_coupon.ends_at IS NOT NULL AND v_coupon.ends_at < now() THEN RAISE EXCEPTION 'คูปองนี้หมดอายุแล้ว'; END IF;
  SELECT count(*) INTO v_live FROM public.customer_coupons WHERE coupon_id = p_coupon_id AND status IN ('available', 'used');
  IF v_coupon.max_redemptions IS NOT NULL AND v_live >= v_coupon.max_redemptions THEN RAISE EXCEPTION 'คูปองนี้หมดแล้ว'; END IF;
  SELECT count(*) INTO v_held FROM public.customer_coupons WHERE coupon_id = p_coupon_id AND customer_id = v_customer_id AND status IN ('available', 'used');
  IF v_held >= v_coupon.per_customer_limit THEN RAISE EXCEPTION 'คุณรับคูปองนี้ครบแล้ว'; END IF;
  INSERT INTO public.customer_coupons(customer_id, coupon_id, status, expires_at)
  VALUES (v_customer_id, p_coupon_id, 'available', v_coupon.ends_at)
  RETURNING id INTO v_wallet_id;
  RETURN jsonb_build_object('wallet_id', v_wallet_id, 'coupon_id', p_coupon_id, 'code', v_coupon.code);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_coupon(p_coupon_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
DECLARE v_admin_id uuid := auth.uid(); v_coupon public.coupons; v_granted integer := 0; v_remaining integer;
BEGIN
  IF v_admin_id IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบเท่านั้นที่แจกคูปองได้'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('coupon-grant:' || p_coupon_id::text));
  SELECT * INTO v_coupon FROM public.coupons WHERE id = p_coupon_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบคูปองที่ต้องการแจก'; END IF;
  IF v_coupon.distribution_type <> 'auto_grant' THEN RAISE EXCEPTION 'คูปองนี้เป็นแบบกดรับเอง ใช้ปุ่มแจกไม่ได้'; END IF;
  IF NOT v_coupon.active THEN RAISE EXCEPTION 'คูปองนี้ถูกปิดใช้งานแล้ว'; END IF;
  IF v_coupon.max_redemptions IS NOT NULL THEN
    SELECT greatest(v_coupon.max_redemptions - count(*), 0) INTO v_remaining FROM public.customer_coupons WHERE coupon_id = p_coupon_id AND status IN ('available', 'used');
  ELSE
    v_remaining := 2147483647;
  END IF;
  WITH candidates AS (
    SELECT ur.user_id FROM public.user_roles ur
    WHERE ur.role = 'customer'
      AND (SELECT count(*) FROM public.customer_coupons w WHERE w.coupon_id = p_coupon_id AND w.customer_id = ur.user_id AND w.status IN ('available', 'used')) < v_coupon.per_customer_limit
    ORDER BY ur.user_id LIMIT v_remaining
  ), granted AS (
    INSERT INTO public.customer_coupons(customer_id, coupon_id, status, expires_at)
    SELECT user_id, p_coupon_id, 'available', v_coupon.ends_at FROM candidates
    RETURNING id
  )
  SELECT count(*) INTO v_granted FROM granted;
  INSERT INTO public.admin_action_audit(actor_id, target_user_id, action, reason, after_state)
  VALUES (v_admin_id, NULL, 'coupon_auto_granted', 'แจกคูปองอัตโนมัติ', jsonb_build_object('coupon_id', p_coupon_id, 'granted', v_granted));
  RETURN jsonb_build_object('coupon_id', p_coupon_id, 'granted', v_granted);
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_auto_coupons_to_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NEW.role = 'customer' THEN
    BEGIN
      INSERT INTO public.customer_coupons(customer_id, coupon_id, status, expires_at)
      SELECT NEW.user_id, c.id, 'available', c.ends_at FROM public.coupons c
      WHERE c.distribution_type = 'auto_grant' AND c.active = true AND c.starts_at <= now() AND (c.ends_at IS NULL OR c.ends_at >= now())
        AND (c.max_redemptions IS NULL OR (SELECT count(*) FROM public.customer_coupons w WHERE w.coupon_id = c.id AND w.status IN ('available', 'used')) < c.max_redemptions)
        AND (SELECT count(*) FROM public.customer_coupons w WHERE w.coupon_id = c.id AND w.customer_id = NEW.user_id AND w.status IN ('available', 'used')) < c.per_customer_limit;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grant_auto_coupons_after_customer_role ON public.user_roles;
CREATE TRIGGER grant_auto_coupons_after_customer_role
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.grant_auto_coupons_to_customer();

REVOKE ALL ON FUNCTION public.claim_customer_coupon(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_customer_coupon(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_grant_coupon(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_coupon(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_coupon_active_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_auto_coupons_to_customer() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.create_food_checkout_group_v3(jsonb, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.create_food_checkout_group_v3(
  p_orders jsonb,
  p_address_id uuid,
  p_payment_method text,
  p_idempotency_key text,
  p_slip_path text DEFAULT NULL,
  p_coupons jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
DECLARE
  v_customer_id uuid := auth.uid();
  v_address public.customer_addresses;
  v_existing public.checkout_groups;
  v_group public.checkout_groups;
  v_store record;
  v_line record;
  v_order public.delivery_orders;
  v_config record;
  v_food_rules jsonb;
  v_address_snapshot jsonb;
  v_pricing_snapshot jsonb;
  v_route_snapshot jsonb := '[]'::jsonb;
  v_orders_result jsonb := '[]'::jsonb;
  v_rendered_address text;
  v_store_count integer := 0;
  v_total_amount numeric := 0;
  v_fee_total numeric := 0;
  v_store_total numeric;
  v_store_fee numeric;
  v_distance numeric;
  v_base_fee numeric;
  v_included_km numeric;
  v_per_km_fee numeric;
  v_service_fee numeric;
  v_zone_multiplier numeric;
  v_item_count integer;
  v_requested_count integer;
  v_status text;
  v_order_key text;
  v_slip_object_path text;
  v_coupons jsonb; v_coupon_code text; v_coupon public.coupons; v_discount numeric; v_discount_total numeric := 0; v_wallet_id uuid;
BEGIN
  IF v_customer_id IS NULL OR NOT private.has_role('customer') THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบด้วยบัญชีลูกค้าก่อนสั่งซื้อ';
  END IF;
  IF char_length(btrim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 12 AND 220 THEN
    RAISE EXCEPTION 'รหัสยืนยันรายการสั่งซื้อไม่ถูกต้อง กรุณาลองใหม่';
  END IF;
  IF p_payment_method NOT IN ('เงินสดปลายทาง (COD)', 'โอนผ่าน QR / แนบสลิป') THEN
    RAISE EXCEPTION 'วิธีชำระเงินไม่อยู่ในรายการที่อนุญาต';
  END IF;
  IF jsonb_typeof(p_orders) <> 'array' OR jsonb_array_length(p_orders) < 1 OR jsonb_array_length(p_orders) > 10 THEN
    RAISE EXCEPTION 'กรุณาเลือกร้านค้า 1–10 ร้านต่อการสั่งซื้อหนึ่งครั้ง';
  END IF;
  IF p_address_id IS NULL THEN RAISE EXCEPTION 'กรุณาเลือกที่อยู่จัดส่ง'; END IF;
  IF p_payment_method = 'โอนผ่าน QR / แนบสลิป' THEN
    IF p_slip_path IS NULL OR btrim(p_slip_path) !~ ('^payment-slips/' || v_customer_id::text || '/') THEN
      RAISE EXCEPTION 'สลิปชำระเงินไม่ถูกต้องหรือไม่ได้เป็นของบัญชีนี้';
    END IF;
    v_slip_object_path := regexp_replace(btrim(p_slip_path), '^payment-slips/', '');
    IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'payment-slips' AND name = v_slip_object_path AND owner_id = v_customer_id) THEN
      RAISE EXCEPTION 'ไม่พบสลิปส่วนตัวที่ผ่านการอัปโหลดของบัญชีนี้';
    END IF;
  ELSIF p_slip_path IS NOT NULL AND btrim(p_slip_path) <> '' THEN
    RAISE EXCEPTION 'การชำระเงินปลายทางไม่ต้องแนบสลิป';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_customer_id::text || ':checkout-group:' || btrim(p_idempotency_key)));
  SELECT * INTO v_existing FROM public.checkout_groups WHERE customer_id = v_customer_id AND idempotency_key = btrim(p_idempotency_key) LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', v_existing.id, 'status', v_existing.status, 'payment_status', v_existing.payment_status,
      'total_amount', v_existing.total_amount, 'payable_amount', v_existing.payable_amount, 'replayed', true,
      'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'store_id', o.store_id, 'store_name', o.store_name, 'total', o.total, 'delivery_fee', o.delivery_fee, 'payable', o.payable, 'status', o.status) ORDER BY o.ordered_at) FROM public.delivery_orders o WHERE o.checkout_group_id = v_existing.id), '[]'::jsonb)
    );
  END IF;

  SELECT * INTO v_address FROM public.customer_addresses WHERE id = p_address_id AND user_id = v_customer_id AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบที่อยู่จัดส่งหรือคุณไม่มีสิทธิ์ใช้ที่อยู่นี้'; END IF;
  v_rendered_address := concat_ws(', ', nullif(v_address.address_line, ''), nullif(v_address.village, ''), nullif(v_address.moo, ''), nullif(v_address.soi, ''), nullif(v_address.road, ''), nullif(v_address.subdistrict, ''), nullif(v_address.district, ''), nullif(v_address.province, ''), nullif(v_address.postal_code, ''));
  v_address_snapshot := jsonb_build_object('address_id', v_address.id, 'label', v_address.label, 'recipient_name', v_address.recipient_name, 'recipient_phone', v_address.recipient_phone, 'address', v_rendered_address, 'delivery_note', v_address.delivery_note, 'location', v_address.location, 'accuracy', v_address.location -> 'accuracy', 'source', v_address.location -> 'source', 'captured_at', now());

  SELECT value, updated_at INTO v_config FROM public.platform_configs WHERE key = 'business_rules' FOR SHARE;
  v_food_rules := v_config.value -> 'food';
  IF v_food_rules IS NULL THEN RAISE EXCEPTION 'ผู้ดูแลระบบยังไม่ได้ตั้งกติกาค่าส่งอาหาร จึงยังไม่สามารถสั่งซื้อได้'; END IF;
  v_base_fee := nullif(v_food_rules ->> 'base_fee', '')::numeric;
  v_included_km := nullif(v_food_rules ->> 'included_km', '')::numeric;
  v_per_km_fee := nullif(v_food_rules ->> 'per_km_fee', '')::numeric;
  v_service_fee := coalesce(nullif(v_food_rules ->> 'service_fee', '')::numeric, 0);
  v_zone_multiplier := coalesce(nullif(v_food_rules ->> 'zone_multiplier', '')::numeric, 1);
  IF v_base_fee IS NULL OR v_included_km IS NULL OR v_per_km_fee IS NULL OR v_base_fee < 0 OR v_included_km < 0 OR v_per_km_fee < 0 OR v_service_fee < 0 OR v_zone_multiplier <= 0 THEN
    RAISE EXCEPTION 'กติกาค่าส่งอาหารของผู้ดูแลระบบไม่สมบูรณ์';
  END IF;
  v_pricing_snapshot := jsonb_build_object('config_key', 'business_rules', 'config_updated_at', v_config.updated_at, 'service', 'food', 'calculation', 'per_store_direct_distance_v1', 'base_fee', v_base_fee, 'included_km', v_included_km, 'per_km_fee', v_per_km_fee, 'service_fee', v_service_fee, 'zone_multiplier', v_zone_multiplier, 'captured_at', now());

  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_orders) AS x(store_id text, items jsonb) WHERE store_id IS NULL OR btrim(store_id) = '' OR jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) < 1 OR jsonb_array_length(items) > 100) THEN
    RAISE EXCEPTION 'ข้อมูลร้านค้าหรือรายการสินค้าไม่ถูกต้อง';
  END IF;
  IF (SELECT count(*) FROM jsonb_to_recordset(p_orders) AS x(store_id text, items jsonb)) <> (SELECT count(DISTINCT btrim(store_id)) FROM jsonb_to_recordset(p_orders) AS x(store_id text, items jsonb)) THEN
    RAISE EXCEPTION 'ไม่สามารถส่งร้านค้าเดียวกันซ้ำในกลุ่มคำสั่งซื้อได้';
  END IF;
  v_coupons := COALESCE(p_coupons, '[]'::jsonb);
  IF jsonb_typeof(v_coupons) <> 'array' THEN RAISE EXCEPTION 'ข้อมูลคูปองไม่ถูกต้อง'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_coupons) AS x(store_id text, code text) WHERE store_id IS NULL OR btrim(store_id) = '' OR code IS NULL OR btrim(code) = '') THEN RAISE EXCEPTION 'ข้อมูลคูปองไม่ถูกต้อง'; END IF;
  IF (SELECT count(*) FROM jsonb_to_recordset(v_coupons) AS x(store_id text, code text)) <> (SELECT count(DISTINCT btrim(store_id)) FROM jsonb_to_recordset(v_coupons) AS x(store_id text, code text)) THEN RAISE EXCEPTION 'ระบุคูปองได้ร้านละ 1 ใบเท่านั้น'; END IF;

  INSERT INTO public.checkout_groups(customer_id, idempotency_key, status, address_snapshot, fee_snapshot, pricing_snapshot, route_snapshot, total_amount, payable_amount, payment_status)
  VALUES (v_customer_id, btrim(p_idempotency_key), 'active', v_address_snapshot, '{}'::jsonb, v_pricing_snapshot, '[]'::jsonb, 0, 0, CASE WHEN p_payment_method = 'โอนผ่าน QR / แนบสลิป' THEN 'under_review' ELSE 'pending' END)
  RETURNING * INTO v_group;

  FOR v_line IN SELECT btrim(store_id) AS store_id, items FROM jsonb_to_recordset(p_orders) AS x(store_id text, items jsonb) LOOP
    IF NOT private.store_accepts_food_orders(v_line.store_id, now()) THEN RAISE EXCEPTION 'ร้านค้า % ไม่พร้อมรับออร์เดอร์ในขณะนี้', v_line.store_id; END IF;
    SELECT id, name, location INTO v_store FROM public.stores WHERE id = v_line.store_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบร้านค้าที่เลือก'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_line.items) AS x(item_id text, quantity integer) WHERE item_id IS NULL OR btrim(item_id) = '' OR quantity IS NULL OR quantity < 1 OR quantity > 99) THEN RAISE EXCEPTION 'สินค้าและจำนวนของร้าน % ไม่ถูกต้อง', v_store.name; END IF;
    WITH requested AS (
      SELECT item_id, sum(quantity)::integer AS quantity FROM jsonb_to_recordset(v_line.items) AS x(item_id text, quantity integer) GROUP BY item_id
    ), verified AS (
      SELECT m.id, m.name, m.emoji, m.price, r.quantity FROM requested r JOIN public.menu_items m ON m.id = r.item_id WHERE m.store_id = v_store.id AND m.available IS TRUE AND m.archived_at IS NULL
    ) SELECT count(*), coalesce(sum(price * quantity), 0) INTO v_item_count, v_store_total FROM verified;
    SELECT count(DISTINCT item_id) INTO v_requested_count FROM jsonb_to_recordset(v_line.items) AS x(item_id text, quantity integer);
    IF v_item_count <> v_requested_count THEN RAISE EXCEPTION 'มีสินค้าไม่พร้อมขายหรือไม่ได้อยู่ในร้าน %', v_store.name; END IF;
    v_discount := 0; v_coupon_code := NULL;
    SELECT btrim(upper(x.code)) INTO v_coupon_code FROM jsonb_to_recordset(v_coupons) AS x(store_id text, code text) WHERE btrim(x.store_id) = v_store.id;
    IF v_coupon_code IS NOT NULL THEN
      SELECT * INTO v_coupon FROM public.coupons WHERE code = v_coupon_code;
      IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบคูปอง %', v_coupon_code; END IF;
      PERFORM pg_advisory_xact_lock(hashtext(v_customer_id::text || ':coupon-use:' || v_coupon.id::text));
      IF NOT v_coupon.active OR v_coupon.starts_at > now() OR (v_coupon.ends_at IS NOT NULL AND v_coupon.ends_at < now()) THEN RAISE EXCEPTION 'คูปอง % หมดอายุหรือไม่พร้อมใช้', v_coupon.code; END IF;
      IF v_coupon.scope_type = 'store' AND NOT EXISTS (SELECT 1 FROM public.coupon_stores WHERE coupon_id = v_coupon.id AND store_id = v_store.id) THEN RAISE EXCEPTION 'คูปอง % ใช้กับร้านนี้ไม่ได้', v_coupon.code; END IF;
      IF v_coupon.scope_type = 'menu' AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_line.items) AS r(item_id text) JOIN public.coupon_menu_items m ON m.menu_item_id = btrim(r.item_id) WHERE m.coupon_id = v_coupon.id) THEN RAISE EXCEPTION 'คูปอง % ใช้กับสินค้าที่เลือกไม่ได้', v_coupon.code; END IF;
      IF v_store_total < COALESCE(v_coupon.min_order_amount, 0) THEN RAISE EXCEPTION 'ยอดร้าน % ยังไม่ถึงขั้นต่ำของคูปอง %', v_store.name, v_coupon.code; END IF;
      IF v_coupon.max_redemptions IS NOT NULL AND (SELECT COUNT(*) FROM public.coupon_redemptions WHERE coupon_id = v_coupon.id) >= v_coupon.max_redemptions THEN RAISE EXCEPTION 'คูปอง % หมดแล้ว', v_coupon.code; END IF;
      IF (SELECT COUNT(*) FROM public.coupon_redemptions WHERE coupon_id = v_coupon.id AND customer_id = v_customer_id) >= v_coupon.per_customer_limit THEN RAISE EXCEPTION 'คุณใช้คูปอง % ครบแล้ว', v_coupon.code; END IF;
      v_discount := CASE WHEN v_coupon.discount_type = 'percent' THEN LEAST(round(v_store_total * v_coupon.discount_value / 100, 2), COALESCE(v_coupon.max_discount_amount, v_store_total)) ELSE LEAST(v_coupon.discount_value, v_store_total) END;
      SELECT id INTO v_wallet_id FROM public.customer_coupons WHERE coupon_id = v_coupon.id AND customer_id = v_customer_id AND status = 'available' ORDER BY claimed_at LIMIT 1 FOR UPDATE;
      IF NOT FOUND THEN
        IF v_coupon.distribution_type = 'claim' THEN RAISE EXCEPTION 'กรุณากดรับคูปอง % ก่อนใช้', v_coupon.code; END IF;
        INSERT INTO public.customer_coupons(customer_id, coupon_id, status, expires_at) VALUES (v_customer_id, v_coupon.id, 'available', v_coupon.ends_at) RETURNING id INTO v_wallet_id;
      END IF;
    END IF;
    v_distance := private.checkout_haversine_km(v_store.location, v_address.location);
    v_store_fee := round(((v_base_fee + greatest(v_distance - v_included_km, 0) * v_per_km_fee + v_service_fee) * v_zone_multiplier)::numeric, 2);
    v_status := CASE WHEN p_payment_method = 'โอนผ่าน QR / แนบสลิป' THEN 'รอตรวจสอบการชำระเงิน' ELSE 'รอแอดมินตรวจสอบ' END;
    v_order_key := 'group:' || md5(v_group.id::text || ':' || v_store.id);
    INSERT INTO public.delivery_orders(customer_id, customer_email, customer_name, store_id, store_name, service_type, status, total, payable, delivery_fee, payment_method, delivery_address, delivery_location, delivery_address_id, delivery_recipient_name, delivery_recipient_phone, delivery_note, delivery_location_accuracy, delivery_location_source, delivery_snapshot, checkout_idempotency_key, checkout_group_id, ordered_at)
    VALUES (v_customer_id, coalesce(auth.jwt() ->> 'email', ''), v_address.recipient_name, v_store.id, v_store.name, 'food', v_status, v_store_total, v_store_total - v_discount + v_store_fee, v_store_fee, p_payment_method, v_rendered_address, v_address.location, v_address.id, v_address.recipient_name, v_address.recipient_phone, v_address.delivery_note, nullif(v_address.location ->> 'accuracy', '')::numeric, nullif(v_address.location ->> 'source', ''), v_address_snapshot || jsonb_build_object('checkout_group_id', v_group.id, 'pricing', v_pricing_snapshot, 'route_distance_km', v_distance, 'delivery_fee', v_store_fee, 'coupon_code', v_coupon_code, 'coupon_discount', v_discount), v_order_key, v_group.id, now()) RETURNING * INTO v_order;
    IF v_coupon_code IS NOT NULL THEN
      UPDATE public.customer_coupons SET status = 'used', order_id = v_order.id, used_at = now() WHERE id = v_wallet_id;
      INSERT INTO public.coupon_redemptions(coupon_id, customer_id, order_id, discount_amount) VALUES (v_coupon.id, v_customer_id, v_order.id, v_discount);
    END IF;
    INSERT INTO public.delivery_order_items(order_id, item_id, name, emoji, unit_price, quantity, options)
    SELECT v_order.id, m.id, m.name, m.emoji, m.price, r.quantity, '{}'::jsonb FROM jsonb_to_recordset(v_line.items) AS r(item_id text, quantity integer) JOIN public.menu_items m ON m.id = r.item_id WHERE m.store_id = v_store.id AND m.available IS TRUE AND m.archived_at IS NULL;
    INSERT INTO public.order_status_events(order_id, status, actor_id, actor_label) VALUES (v_order.id, v_status, v_customer_id, 'Customer');
    v_store_count := v_store_count + 1; v_total_amount := v_total_amount + v_store_total; v_fee_total := v_fee_total + v_store_fee; v_discount_total := v_discount_total + v_discount;
    v_route_snapshot := v_route_snapshot || jsonb_build_array(jsonb_build_object('order_id', v_order.id, 'store_id', v_store.id, 'store_name', v_store.name, 'store_location', v_store.location, 'delivery_location', v_address.location, 'direct_distance_km', v_distance, 'delivery_fee', v_store_fee));
    v_orders_result := v_orders_result || jsonb_build_array(jsonb_build_object('id', v_order.id, 'store_id', v_store.id, 'store_name', v_store.name, 'total', v_store_total, 'delivery_fee', v_store_fee, 'payable', v_store_total - v_discount + v_store_fee, 'discount', v_discount, 'status', v_status));
  END LOOP;

  UPDATE public.checkout_groups SET fee_snapshot = v_pricing_snapshot || jsonb_build_object('group_delivery_fee', v_fee_total, 'store_count', v_store_count), route_snapshot = v_route_snapshot, total_amount = v_total_amount - v_discount_total + v_fee_total, payable_amount = v_total_amount - v_discount_total + v_fee_total, updated_at = now() WHERE id = v_group.id;
  INSERT INTO public.checkout_group_payments(checkout_group_id, customer_id, method, expected_amount, status, slip_path, payment_snapshot)
  VALUES (v_group.id, v_customer_id, p_payment_method, v_total_amount - v_discount_total + v_fee_total, CASE WHEN p_payment_method = 'โอนผ่าน QR / แนบสลิป' THEN 'under_review' ELSE 'pending' END, CASE WHEN p_payment_method = 'โอนผ่าน QR / แนบสลิป' THEN btrim(p_slip_path) ELSE NULL END, jsonb_build_object('checkout_group_id', v_group.id, 'method', p_payment_method, 'expected_amount', v_total_amount - v_discount_total + v_fee_total, 'slip_path', CASE WHEN p_payment_method = 'โอนผ่าน QR / แนบสลิป' THEN btrim(p_slip_path) ELSE NULL END, 'created_at', now()));
  PERFORM public.refresh_checkout_group_aggregate(v_group.id);
  INSERT INTO public.checkout_group_events(checkout_group_id, actor_id, actor_role, action, idempotency_key, after_state) VALUES (v_group.id, v_customer_id, 'customer', 'checkout_group_created', btrim(p_idempotency_key), jsonb_build_object('store_count', v_store_count, 'total_amount', v_total_amount - v_discount_total + v_fee_total, 'payment_method', p_payment_method, 'orders', v_orders_result));
  RETURN jsonb_build_object('id', v_group.id, 'status', 'active', 'payment_status', CASE WHEN p_payment_method = 'โอนผ่าน QR / แนบสลิป' THEN 'under_review' ELSE 'pending' END, 'total_amount', v_total_amount - v_discount_total + v_fee_total, 'payable_amount', v_total_amount - v_discount_total + v_fee_total, 'store_count', v_store_count, 'orders', v_orders_result, 'replayed', false);
END;
$$;

NOTIFY pgrst, 'reload schema';
