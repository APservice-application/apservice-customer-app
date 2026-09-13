-- B1 fix: single actionable notification per party (was duplicated).
-- Merchant new-order and rider open-job now fire only at store-accepted (release),
-- not at INSERT when the order may still be invisible (payment review / admin review).
-- Keeps the assigned-rider notice; keeps customer timeline + payout notices.
CREATE OR REPLACE FUNCTION public.queue_order_mobile_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- A job explicitly assigned by Admin is sent only to the assigned rider.
  IF tg_op = 'UPDATE'
    AND new.rider_id IS NOT NULL
    AND old.rider_id IS DISTINCT FROM new.rider_id THEN
    INSERT INTO public.mobile_notifications (recipient_id, recipient_role, title, body, data)
    SELECT
      r.user_id,
      'rider',
      'คุณได้รับมอบหมายงาน',
      concat(new.store_name, ' → ', new.delivery_address),
      jsonb_build_object('orderId', new.id, 'screen', 'jobs')
    FROM public.riders r
    WHERE r.id = new.rider_id AND r.user_id IS NOT NULL;
  END IF;

  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_owner_id uuid;
  v_rider_user_id uuid;
  v_title text;
  v_body text;
  v_link text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  v_link := 'order.html?id=' || NEW.id;
  SELECT s.owner_id INTO v_owner_id FROM public.stores s WHERE s.id = NEW.store_id;
  IF NEW.rider_id IS NOT NULL THEN
    SELECT r.user_id INTO v_rider_user_id FROM public.riders r WHERE r.id = NEW.rider_id;
  END IF;

  -- Customer timeline (skip payment_review: it is the customer's own action echo).
  v_title := CASE NEW.status
    WHEN 'ร้านค้ารับออร์เดอร์' THEN CASE WHEN NEW.payment_method = 'โอนผ่าน QR / แนบสลิป' THEN 'ชำระเงินผ่านแล้ว' ELSE 'ร้านรับออร์เดอร์แล้ว' END
    WHEN 'กำลังเตรียมสินค้า' THEN 'ร้านกำลังเตรียมสินค้า'
    WHEN 'ไรเดอร์กำลังไปรับ' THEN 'ไรเดอร์รับงานแล้ว'
    WHEN 'ถึงร้านค้า' THEN 'ไรเดอร์ถึงร้านแล้ว'
    WHEN 'รับสินค้าแล้ว' THEN 'ไรเดอร์รับสินค้าแล้ว'
    WHEN 'กำลังไปส่ง' THEN 'สินค้ากำลังมาส่ง'
    WHEN 'สำเร็จแล้ว' THEN 'จัดส่งสำเร็จแล้ว'
    WHEN 'ต้องแนบสลิปใหม่' THEN 'สลิปไม่ผ่าน กรุณาแนบใหม่'
    WHEN 'ยกเลิก' THEN 'ออร์เดอร์ถูกยกเลิก'
    ELSE NULL END;
  v_body := CASE NEW.status
    WHEN 'ร้านค้ารับออร์เดอร์' THEN CASE WHEN NEW.payment_method = 'โอนผ่าน QR / แนบสลิป' THEN 'สลิปของออร์เดอร์ ' || NEW.id || ' ผ่านแล้ว ร้านกำลังเตรียมสินค้า' ELSE 'ร้าน' || coalesce(' ' || NEW.store_name, '') || ' รับออร์เดอร์ ' || NEW.id || ' แล้ว' END
    WHEN 'กำลังเตรียมสินค้า' THEN 'ออร์เดอร์ ' || NEW.id || ' อยู่ระหว่างเตรียมสินค้า'
    WHEN 'ไรเดอร์กำลังไปรับ' THEN 'ไรเดอร์รับงานออร์เดอร์ ' || NEW.id || ' แล้ว กำลังเดินทางไปร้าน'
    WHEN 'ถึงร้านค้า' THEN 'ไรเดอร์ถึงร้านแล้วสำหรับออร์เดอร์ ' || NEW.id
    WHEN 'รับสินค้าแล้ว' THEN 'ไรเดอร์รับสินค้าออร์เดอร์ ' || NEW.id || ' แล้ว กำลังนำส่ง'
    WHEN 'กำลังไปส่ง' THEN 'ออร์เดอร์ ' || NEW.id || ' กำลังมาส่งถึงคุณ'
    WHEN 'สำเร็จแล้ว' THEN 'ออร์เดอร์ ' || NEW.id || ' จัดส่งสำเร็จแล้ว ขอบคุณที่ใช้บริการ'
    WHEN 'ต้องแนบสลิปใหม่' THEN 'สลิปของออร์เดอร์ ' || NEW.id || ' ไม่ผ่าน กรุณาแนบสลิปใหม่ในหน้ารายละเอียดออร์เดอร์'
    WHEN 'ยกเลิก' THEN 'ออร์เดอร์ ' || NEW.id || ' ถูกยกเลิกแล้ว'
    ELSE NULL END;
  IF v_title IS NOT NULL AND NEW.customer_id IS NOT NULL THEN
    INSERT INTO public.mobile_notifications(recipient_id, recipient_role, title, body, data, status, created_at, sent_at)
    VALUES (NEW.customer_id, 'customer', v_title, v_body,
      jsonb_build_object('order_id', NEW.id, 'status', NEW.status, 'deep_link', v_link), 'sent', now(), now());
  END IF;

  -- Merchant: new order just landed in their queue.
  IF NEW.status = 'ร้านค้ารับออร์เดอร์' AND v_owner_id IS NOT NULL THEN
    INSERT INTO public.mobile_notifications(recipient_id, recipient_role, title, body, data, status, created_at, sent_at)
    VALUES (v_owner_id, 'store_owner', 'มีออร์เดอร์ใหม่', 'ออร์เดอร์ ' || NEW.id || ' ยอด ' || coalesce(NEW.payable::text, NEW.total::text, '-') || ' บาท กรุณากดรับและเตรียมสินค้า',
      jsonb_build_object('order_id', NEW.id, 'status', NEW.status, 'deep_link', v_link), 'sent', now(), now());
  END IF;

  -- Rider: payout landed.
  IF NEW.status = 'สำเร็จแล้ว' AND v_rider_user_id IS NOT NULL THEN
    INSERT INTO public.mobile_notifications(recipient_id, recipient_role, title, body, data, status, created_at, sent_at)
    VALUES (v_rider_user_id, 'rider', 'งานสำเร็จ รายได้เข้าแล้ว', 'ออร์เดอร์ ' || NEW.id || ' สำเร็จแล้ว รายได้เข้ากระเป๋าเงินของคุณแล้ว',
      jsonb_build_object('order_id', NEW.id, 'status', NEW.status, 'deep_link', 'delivery.html?id=' || NEW.id), 'sent', now(), now());
  END IF;

  -- Merchant: payout landed.
  IF NEW.status = 'สำเร็จแล้ว' AND v_owner_id IS NOT NULL THEN
    INSERT INTO public.mobile_notifications(recipient_id, recipient_role, title, body, data, status, created_at, sent_at)
    VALUES (v_owner_id, 'store_owner', 'ออร์เดอร์สำเร็จ เงินเข้าแล้ว', 'ออร์เดอร์ ' || NEW.id || ' สำเร็จแล้ว ยอดเข้ากระเป๋าเงินร้านของคุณแล้ว',
      jsonb_build_object('order_id', NEW.id, 'status', NEW.status, 'deep_link', v_link), 'sent', now(), now());
  END IF;

  -- Open job broadcast once, when the job becomes claimable (cap fan-out).
  IF NEW.status = 'ร้านค้ารับออร์เดอร์' AND NEW.rider_id IS NULL
     AND COALESCE(NEW.service_type, 'food') <> 'ap_ride' THEN
    INSERT INTO public.mobile_notifications(recipient_id, recipient_role, title, body, data, status, created_at, sent_at)
    SELECT r.user_id, 'rider', 'มีงานจัดส่งใหม่', 'ออร์เดอร์ ' || NEW.id || ' จากร้าน' || coalesce(' ' || NEW.store_name, '') || ' รอไรเดอร์รับงาน',
      jsonb_build_object('order_id', NEW.id, 'status', NEW.status, 'deep_link', 'delivery.html?id=' || NEW.id), 'sent', now(), now()
    FROM public.riders r
    WHERE r.user_id IS NOT NULL AND r.ride_available IS TRUE AND lower(coalesce(r.compliance_status, '')) = 'approved'
    LIMIT 200;
  END IF;

  RETURN NEW;
END;
$$;
