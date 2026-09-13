-- A3 fixes:
-- 1) allow 'slip_resubmitted' group event (resubmit RPC was blocked by action CHECK).
-- 2) verify verdict also advances orders sitting at reupload status (rejected->verified path).
ALTER TABLE public.checkout_group_events DROP CONSTRAINT IF EXISTS checkout_group_events_action_check;
ALTER TABLE public.checkout_group_events ADD CONSTRAINT checkout_group_events_action_check
  CHECK (action = ANY (ARRAY['checkout_group_created'::text, 'payment_reviewed'::text, 'aggregate_updated'::text, 'slip_resubmitted'::text]));

CREATE OR REPLACE FUNCTION public.admin_review_checkout_group_payment(p_checkout_group_id uuid, p_decision text, p_reason text, p_idempotency_key text, p_evidence_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_payment public.checkout_group_payments;
  v_before jsonb;
  v_status text;
  v_reason text;
  v_evidence text;
BEGIN
  IF v_admin_id IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบเท่านั้นที่ตรวจสอบการชำระเงินได้'; END IF;
  IF p_decision NOT IN ('verify','reject') THEN RAISE EXCEPTION 'ผลพิจารณาไม่ถูกต้อง'; END IF;
  IF char_length(btrim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 12 AND 220 THEN RAISE EXCEPTION 'รหัสยืนยันการตรวจสอบไม่ถูกต้อง'; END IF;
  v_reason := private.require_admin_override_reason(p_reason);
  v_evidence := private.validate_admin_override_evidence(p_evidence_path);
  PERFORM pg_advisory_xact_lock(hashtext(v_admin_id::text || ':checkout-group-payment:' || btrim(p_idempotency_key)));
  IF EXISTS (SELECT 1 FROM public.checkout_group_events WHERE checkout_group_id = p_checkout_group_id AND idempotency_key = btrim(p_idempotency_key)) THEN
    SELECT * INTO v_payment FROM public.checkout_group_payments WHERE checkout_group_id = p_checkout_group_id;
    RETURN jsonb_build_object('checkout_group_id', p_checkout_group_id, 'status', v_payment.status, 'replayed', true);
  END IF;
  SELECT * INTO v_payment FROM public.checkout_group_payments WHERE checkout_group_id = p_checkout_group_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบการชำระเงินของกลุ่มคำสั่งซื้อ'; END IF;
  IF v_payment.method <> 'โอนผ่าน QR / แนบสลิป' OR v_payment.status NOT IN ('under_review','rejected') THEN RAISE EXCEPTION 'รายการชำระเงินกลุ่มนี้ยังไม่อยู่ในสถานะที่พิจารณาได้'; END IF;
  v_before := jsonb_build_object('status', v_payment.status, 'expected_amount', v_payment.expected_amount, 'slip_path', v_payment.slip_path);
  v_status := CASE WHEN p_decision = 'verify' THEN 'verified' ELSE 'rejected' END;
  UPDATE public.checkout_group_payments SET status = v_status, reviewed_at = now(), reviewed_by = v_admin_id, reviewer_note = v_reason, updated_at = now() WHERE id = v_payment.id;
  INSERT INTO public.checkout_group_events(checkout_group_id, actor_id, actor_role, action, idempotency_key, before_state, after_state, reason)
  VALUES (p_checkout_group_id, v_admin_id, 'admin', 'payment_reviewed', btrim(p_idempotency_key), v_before, jsonb_build_object('status', v_status), v_reason);
  INSERT INTO public.admin_action_audit(actor_id, target_user_id, target_type, target_id, action, reason, evidence_path, before_state, after_state, metadata)
  VALUES (v_admin_id, v_payment.customer_id, 'checkout_group', p_checkout_group_id::text, 'checkout_group_payment_reviewed', v_reason, v_evidence, v_before, jsonb_build_object('checkout_group_id', p_checkout_group_id, 'status', v_status), jsonb_build_object('override', true, 'financial', true));
  -- A1: advance member orders so slip verdict moves the order (was stuck at payment review).
  IF v_status = 'verified' THEN
    INSERT INTO public.order_status_events(order_id, status, actor_id, actor_label)
    SELECT id, 'ร้านค้ารับออร์เดอร์', v_admin_id, 'Admin' FROM public.delivery_orders
    WHERE checkout_group_id = p_checkout_group_id AND status IN ('รอตรวจสอบการชำระเงิน', 'ต้องแนบสลิปใหม่');
    UPDATE public.delivery_orders SET status = 'ร้านค้ารับออร์เดอร์', accepted_at = COALESCE(accepted_at, now()), updated_at = now()
    WHERE checkout_group_id = p_checkout_group_id AND status IN ('รอตรวจสอบการชำระเงิน', 'ต้องแนบสลิปใหม่');
  ELSIF v_status = 'rejected' THEN
    INSERT INTO public.order_status_events(order_id, status, actor_id, actor_label)
    SELECT id, 'ต้องแนบสลิปใหม่', v_admin_id, 'Admin' FROM public.delivery_orders
    WHERE checkout_group_id = p_checkout_group_id AND status IN ('รอตรวจสอบการชำระเงิน', 'ต้องแนบสลิปใหม่');
    UPDATE public.delivery_orders SET status = 'ต้องแนบสลิปใหม่', updated_at = now()
    WHERE checkout_group_id = p_checkout_group_id AND status IN ('รอตรวจสอบการชำระเงิน', 'ต้องแนบสลิปใหม่');
  END IF;
  RETURN jsonb_build_object('checkout_group_id', p_checkout_group_id, 'status', v_status, 'replayed', false);
END;
$function$
