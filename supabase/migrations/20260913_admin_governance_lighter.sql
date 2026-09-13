-- ผ่อนกฎ governance ฝั่ง server ให้ตรงกับที่ Admin ขอ: เหตุผลสั้น ๆ 3 ตัวอักษรก็บันทึกได้
-- และบันทึกโอนถอนเงินใช้เลขอ้างอิงอย่างเดียวได้โดยไม่บังคับรูปหลักฐาน

CREATE OR REPLACE FUNCTION private.require_admin_override_reason(p_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'กรุณาระบุเหตุผลการดำเนินการอย่างน้อย 3 ตัวอักษร';
  END IF;
  RETURN left(v_reason, 500);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_withdrawal(p_request_id uuid, p_action text, p_proof_image_url text DEFAULT '', p_payment_reference text DEFAULT '', p_admin_note text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'Only administrators can review withdrawals'; END IF;
  IF p_action NOT IN ('approved','rejected','paid') THEN RAISE EXCEPTION 'Invalid review action'; END IF;
  IF p_action='paid' AND COALESCE(trim(p_proof_image_url),'')='' AND COALESCE(trim(p_payment_reference),'')='' THEN RAISE EXCEPTION 'การบันทึกโอนต้องมีเลขอ้างอิงหรือหลักฐานการโอนอย่างน้อยหนึ่งอย่าง'; END IF;
  UPDATE public.withdrawal_requests SET status=p_action, admin_note=LEFT(COALESCE(p_admin_note,''),500), proof_image_url=CASE WHEN p_action='paid' THEN p_proof_image_url ELSE proof_image_url END, payment_reference=CASE WHEN p_action='paid' THEN COALESCE(p_payment_reference,'') ELSE payment_reference END, reviewed_by=auth.uid(), reviewed_at=now(), paid_at=CASE WHEN p_action='paid' THEN now() ELSE paid_at END WHERE id=p_request_id AND status IN ('requested','approved');
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal request not found or already closed'; END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
