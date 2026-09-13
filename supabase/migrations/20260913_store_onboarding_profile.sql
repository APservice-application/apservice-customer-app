-- Store onboarding completeness: server-computed profile_pct, open-gate + customer visibility block.
-- Checklist (100): name 15, image 15, phone 10, address 15, hours 15, payout 15, menu 15.
-- profile_exempt = admin-created / grandfathered stores may open before 100%.

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS profile_pct smallint NOT NULL DEFAULT 0;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS profile_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS profile_missing text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION private.compute_store_profile(p_store public.stores)
RETURNS TABLE (pct smallint, missing text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_pct int := 0;
  v_missing text[] := '{}';
  v_hours_ok boolean := false;
  v_menu_ok boolean := false;
  v_payout_ok boolean := false;
  v_digits text;
BEGIN
  IF length(trim(COALESCE(p_store.name, ''))) >= 2 THEN v_pct := v_pct + 15; ELSE v_missing := v_missing || ARRAY['name']; END IF;
  IF length(trim(COALESCE(p_store.image_url, ''))) > 0 THEN v_pct := v_pct + 15; ELSE v_missing := v_missing || ARRAY['image']; END IF;
  v_digits := regexp_replace(COALESCE(p_store.phone, ''), '[^0-9]', '', 'g');
  IF length(v_digits) >= 9 THEN v_pct := v_pct + 10; ELSE v_missing := v_missing || ARRAY['phone']; END IF;
  IF length(trim(COALESCE(p_store.pickup_address, ''))) >= 5 THEN v_pct := v_pct + 15; ELSE v_missing := v_missing || ARRAY['address']; END IF;
  SELECT EXISTS (SELECT 1 FROM public.store_opening_hours WHERE store_id = p_store.id AND is_closed IS FALSE) INTO v_hours_ok;
  IF v_hours_ok THEN v_pct := v_pct + 15; ELSE v_missing := v_missing || ARRAY['hours']; END IF;
  v_payout_ok := CASE trim(COALESCE(p_store.payout_method, ''))
    WHEN 'bank' THEN length(trim(COALESCE(p_store.payout_bank_name, ''))) > 0
      AND length(trim(COALESCE(p_store.payout_account_name, ''))) > 0
      AND length(trim(COALESCE(p_store.payout_account_number, ''))) >= 9
    WHEN 'qr' THEN length(trim(COALESCE(p_store.payout_account_number, ''))) >= 9
      OR length(trim(COALESCE(p_store.payout_qr_url, ''))) > 0
    WHEN 'cash' THEN true
    WHEN 'other' THEN true
    ELSE false END;
  IF v_payout_ok THEN v_pct := v_pct + 15; ELSE v_missing := v_missing || ARRAY['payout']; END IF;
  SELECT EXISTS (SELECT 1 FROM public.menu_items WHERE store_id = p_store.id AND archived_at IS NULL AND available IS TRUE AND stock > 0) INTO v_menu_ok;
  IF v_menu_ok THEN v_pct := v_pct + 15; ELSE v_missing := v_missing || ARRAY['menu']; END IF;
  pct := v_pct::smallint;
  missing := v_missing;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION private.stores_profile_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE v_prof record;
BEGIN
  SELECT * INTO v_prof FROM private.compute_store_profile(NEW);
  NEW.profile_pct := v_prof.pct;
  NEW.profile_missing := v_prof.missing;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stores_profile_pct_trg ON public.stores;
CREATE TRIGGER stores_profile_pct_trg
BEFORE INSERT OR UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION private.stores_profile_trigger();

CREATE OR REPLACE FUNCTION private.refresh_store_profile_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE v_store_id text;
BEGIN
  v_store_id := COALESCE(NEW.store_id, OLD.store_id);
  IF v_store_id IS NOT NULL THEN
    UPDATE public.stores SET updated_at = updated_at WHERE id = v_store_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS store_hours_profile_trg ON public.store_opening_hours;
CREATE TRIGGER store_hours_profile_trg
AFTER INSERT OR UPDATE OR DELETE ON public.store_opening_hours
FOR EACH ROW EXECUTE FUNCTION private.refresh_store_profile_trigger();

DROP TRIGGER IF EXISTS menu_items_profile_trg ON public.menu_items;
CREATE TRIGGER menu_items_profile_trg
AFTER INSERT OR UPDATE OR DELETE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION private.refresh_store_profile_trigger();

-- Grandfather existing stores (all admin-created era): exempt, keep selling. Trigger computes pct.
UPDATE public.stores SET profile_exempt = true WHERE profile_exempt IS NOT TRUE;

-- Open-gate: merchant cannot turn active on unless 100% or exempt.
CREATE OR REPLACE FUNCTION public.merchant_update_store_operations(
  p_active boolean,
  p_emergency_closed boolean,
  p_emergency_note text,
  p_hours jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE v_store public.stores%ROWTYPE; v_before jsonb; v_hours jsonb := COALESCE(p_hours, '[]'::jsonb); v_row jsonb; v_weekday integer; v_open time; v_close time; v_cutoff integer; v_missing_labels text;
BEGIN
  SELECT * INTO v_store FROM public.stores WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบร้านค้าที่ผูกกับบัญชีนี้'; END IF;
  IF p_active IS NULL OR p_emergency_closed IS NULL OR jsonb_typeof(v_hours) <> 'array' OR jsonb_array_length(v_hours) <> 7 THEN RAISE EXCEPTION 'ข้อมูลสถานะร้านหรือตารางเวลาไม่ครบ'; END IF;
  IF p_emergency_closed AND length(trim(COALESCE(p_emergency_note, ''))) < 3 THEN RAISE EXCEPTION 'กรุณาระบุเหตุผลปิดฉุกเฉินอย่างน้อย 3 ตัวอักษร'; END IF;
  v_before := jsonb_build_object('active', v_store.active, 'emergency_closed', v_store.emergency_closed, 'emergency_note', v_store.emergency_note, 'hours', COALESCE((SELECT jsonb_agg(jsonb_build_object('weekday', weekday, 'is_closed', is_closed, 'open_time', open_time, 'close_time', close_time, 'order_cutoff_minutes', order_cutoff_minutes) ORDER BY weekday) FROM public.store_opening_hours WHERE store_id = v_store.id), '[]'::jsonb));
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_hours) LOOP
    v_weekday := (v_row->>'weekday')::integer;
    IF v_weekday < 0 OR v_weekday > 6 THEN RAISE EXCEPTION 'วันในตารางเวลาไม่ถูกต้อง'; END IF;
    IF COALESCE((v_row->>'is_closed')::boolean, false) THEN
      INSERT INTO public.store_opening_hours(store_id, weekday, is_closed, open_time, close_time, order_cutoff_minutes, updated_by, updated_at)
      VALUES (v_store.id, v_weekday, true, NULL, NULL, 0, auth.uid(), now())
      ON CONFLICT (store_id, weekday) DO UPDATE SET is_closed = true, open_time = NULL, close_time = NULL, order_cutoff_minutes = 0, updated_by = auth.uid(), updated_at = now();
    ELSE
      v_open := (v_row->>'open_time')::time; v_close := (v_row->>'close_time')::time; v_cutoff := COALESCE((v_row->>'order_cutoff_minutes')::integer, v_store.order_cutoff_minutes);
      IF v_open IS NULL OR v_close IS NULL OR v_open >= v_close OR v_cutoff < 0 OR v_cutoff > 180 OR v_close - make_interval(mins => v_cutoff) <= v_open THEN RAISE EXCEPTION 'เวลาเปิด ปิด หรือเวลาตัดรับออร์เดอร์ไม่ถูกต้อง'; END IF;
      INSERT INTO public.store_opening_hours(store_id, weekday, is_closed, open_time, close_time, order_cutoff_minutes, updated_by, updated_at)
      VALUES (v_store.id, v_weekday, false, v_open, v_close, v_cutoff, auth.uid(), now())
      ON CONFLICT (store_id, weekday) DO UPDATE SET is_closed = false, open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time, order_cutoff_minutes = EXCLUDED.order_cutoff_minutes, updated_by = auth.uid(), updated_at = now();
    END IF;
  END LOOP;
  -- Recompute profile AFTER hours are written (hours may be the last missing item), then gate opening.
  UPDATE public.stores SET updated_at = updated_at WHERE id = v_store.id;
  SELECT * INTO v_store FROM public.stores WHERE id = v_store.id;
  IF p_active IS TRUE AND v_store.profile_pct < 100 AND v_store.profile_exempt IS NOT TRUE THEN
    SELECT string_agg(CASE m WHEN 'name' THEN 'ชื่อร้าน' WHEN 'image' THEN 'รูปหน้าร้าน' WHEN 'phone' THEN 'เบอร์โทร' WHEN 'address' THEN 'ที่อยู่ร้าน' WHEN 'hours' THEN 'เวลาเปิด-ปิด' WHEN 'payout' THEN 'บัญชีรับเงิน' WHEN 'menu' THEN 'เมนูพร้อมขาย' ELSE m END, ' · ') INTO v_missing_labels FROM unnest(v_store.profile_missing) m;
    RAISE EXCEPTION 'ข้อมูลร้านยังไม่ครบ (% กรุณากรอกให้ครบ 100%% ก่อนเปิดรับออร์เดอร์ — ขาด: %', v_store.profile_pct, COALESCE(v_missing_labels, '');
  END IF;
  UPDATE public.stores SET active = p_active, emergency_closed = p_emergency_closed, emergency_note = CASE WHEN p_emergency_closed THEN left(trim(p_emergency_note), 500) ELSE NULL END, emergency_closed_at = CASE WHEN p_emergency_closed THEN now() ELSE NULL END, updated_at = now() WHERE id = v_store.id;
  INSERT INTO public.store_operation_events(store_id, actor_id, action, reason, before_state, after_state)
  SELECT v_store.id, auth.uid(), 'merchant_operations_updated', CASE WHEN p_emergency_closed THEN left(trim(p_emergency_note), 500) ELSE '' END, v_before, jsonb_build_object('active', p_active, 'emergency_closed', p_emergency_closed, 'hours', v_hours);
  RETURN (SELECT jsonb_build_object('store_id', id, 'active', active, 'emergency_closed', emergency_closed, 'emergency_note', emergency_note, 'profile_pct', profile_pct, 'profile_exempt', profile_exempt, 'profile_missing', profile_missing) FROM public.stores WHERE id = v_store.id);
END;
$$;

-- Checkout-time guard: incomplete non-exempt stores never accept food orders.
CREATE OR REPLACE FUNCTION private.store_accepts_food_orders(target_store_id text, at_time timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE v_store public.stores%ROWTYPE; v_hour public.store_opening_hours%ROWTYPE; v_local timestamp; v_time time; v_weekday smallint;
BEGIN
  SELECT * INTO v_store FROM public.stores WHERE id = target_store_id;
  IF NOT FOUND OR v_store.active IS NOT TRUE OR v_store.emergency_closed IS TRUE OR v_store.moderation_status <> 'active' OR (v_store.profile_pct < 100 AND v_store.profile_exempt IS NOT TRUE) THEN RETURN false; END IF;
  v_local := at_time AT TIME ZONE 'Asia/Bangkok'; v_time := v_local::time; v_weekday := EXTRACT(DOW FROM v_local)::smallint;
  SELECT * INTO v_hour FROM public.store_opening_hours WHERE store_id = target_store_id AND weekday = v_weekday;
  IF FOUND THEN
    IF v_hour.is_closed THEN RETURN false; END IF;
    RETURN v_time >= v_hour.open_time AND v_time < (v_hour.close_time - make_interval(mins => v_hour.order_cutoff_minutes));
  END IF;
  RETURN v_time >= v_store.open_time AND v_time < (v_store.close_time - make_interval(mins => v_store.order_cutoff_minutes));
END;
$$;

-- Customer block: hide incomplete stores everywhere; name + image always required.
CREATE OR REPLACE VIEW public.catalog_stores AS
SELECT s.id,
       s.name,
       s.emoji,
       s.description,
       s.rating,
       s.eta,
       s.location,
       s.active,
       s.image_url,
       s.review_count,
       s.open_time,
       s.close_time,
       s.order_cutoff_minutes,
       s.emergency_closed,
       s.emergency_note,
       s.category_id,
       c.name AS category_name,
       c.icon AS category_icon,
       s.background_url,
       s.image_url AS icon_url
FROM public.stores s
LEFT JOIN public.store_categories c ON c.id = s.category_id
WHERE s.active IS TRUE AND s.emergency_closed IS FALSE
  AND (s.profile_pct >= 100 OR s.profile_exempt IS TRUE)
  AND nullif(trim(s.name), '') IS NOT NULL
  AND nullif(trim(s.image_url), '') IS NOT NULL;

GRANT SELECT ON public.catalog_stores TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
