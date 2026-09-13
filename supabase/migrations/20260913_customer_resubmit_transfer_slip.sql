-- A3: customer resubmits a transfer slip after admin rejection.
-- Moves group payment rejected -> under_review and member orders back to payment review.
CREATE OR REPLACE FUNCTION public.resubmit_transfer_slip(
  p_checkout_group_id uuid,
  p_slip_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
DECLARE
  v_customer_id uuid := auth.uid();
  v_payment public.checkout_group_payments;
  v_slip_object_path text;
  v_order_count integer := 0;
BEGIN
  IF v_customer_id IS NULL OR NOT private.has_role('customer') THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบด้วยบัญชีลูกค้าก่อนแนบสลิปใหม่';
  END IF;
  SELECT * INTO v_payment FROM public.checkout_group_payments WHERE checkout_group_id = p_checkout_group_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบการชำระเงินของกลุ่มคำสั่งซื้อ'; END IF;
  IF v_payment.customer_id IS DISTINCT FROM v_customer_id THEN RAISE EXCEPTION 'คุณไม่มีสิทธิ์แนบสลิปของกลุ่มคำสั่งซื้อนี้'; END IF;
  IF v_payment.method <> 'โอนผ่าน QR / แนบสลิป' OR v_payment.status <> 'rejected' THEN
    RAISE EXCEPTION 'กลุ่มคำสั่งซื้อนี้ไม่อยู่ในสถานะที่แนบสลิปใหม่ได้';
  END IF;
  IF p_slip_path IS NULL OR btrim(p_slip_path) !~ ('^payment-slips/' || v_customer_id::text || '/') THEN
    RAISE EXCEPTION 'สลิปชำระเงินไม่ถูกต้องหรือไม่ได้เป็นของบัญชีนี้';
  END IF;
  v_slip_object_path := regexp_replace(btrim(p_slip_path), '^payment-slips/', '');
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'payment-slips' AND name = v_slip_object_path AND owner_id = v_customer_id::text) THEN
    RAISE EXCEPTION 'ไม่พบสลิปส่วนตัวที่ผ่านการอัปโหลดของบัญชีนี้';
  END IF;
  UPDATE public.checkout_group_payments
  SET status = 'under_review', slip_path = btrim(p_slip_path),
      reviewed_at = NULL, reviewed_by = NULL, reviewer_note = NULL, updated_at = now()
  WHERE id = v_payment.id;
  INSERT INTO public.order_status_events(order_id, status, actor_id, actor_label)
  SELECT id, 'รอตรวจสอบการชำระเงิน', v_customer_id, 'Customer' FROM public.delivery_orders
  WHERE checkout_group_id = p_checkout_group_id AND status = 'ต้องแนบสลิปใหม่';
  GET DIAGNOSTICS v_order_count = ROW_COUNT;
  UPDATE public.delivery_orders SET status = 'รอตรวจสอบการชำระเงิน', updated_at = now()
  WHERE checkout_group_id = p_checkout_group_id AND status = 'ต้องแนบสลิปใหม่';
  INSERT INTO public.checkout_group_events(checkout_group_id, actor_id, actor_role, action, idempotency_key, before_state, after_state)
  VALUES (p_checkout_group_id, v_customer_id, 'customer', 'slip_resubmitted', 'resubmit:' || md5(btrim(p_slip_path)),
    jsonb_build_object('status', 'rejected'), jsonb_build_object('status', 'under_review', 'slip_path', btrim(p_slip_path)));
  RETURN jsonb_build_object('checkout_group_id', p_checkout_group_id, 'status', 'under_review', 'orders_moved', v_order_count);
END;
$$;

REVOKE ALL ON FUNCTION public.resubmit_transfer_slip(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resubmit_transfer_slip(uuid, text) TO authenticated;
