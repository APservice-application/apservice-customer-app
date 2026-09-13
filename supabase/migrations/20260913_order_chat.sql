-- Order-scoped chat (customer + store owner + assigned rider + admin).
-- Text + voice (private bucket chat-voice). History is purged when the order
-- reaches a terminal state (trigger) + daily cron safety net. No secrets here.
-- NOTE: delivery_orders.id is text, rider_id is the riders entity id (text).

CREATE TABLE IF NOT EXISTS public.order_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('customer', 'store_owner', 'rider', 'admin')),
  kind text NOT NULL CHECK (kind IN ('text', 'voice')),
  body text NULL CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 2000),
  voice_path text NULL CHECK (voice_path IS NULL OR (char_length(voice_path) BETWEEN 1 AND 512)),
  voice_seconds integer NULL CHECK (voice_seconds IS NULL OR (voice_seconds BETWEEN 1 AND 180)),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'text' AND body IS NOT NULL AND voice_path IS NULL)
    OR (kind = 'voice' AND voice_path IS NOT NULL AND voice_seconds IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS order_chat_messages_order_created_idx
  ON public.order_chat_messages (order_id, created_at);

CREATE OR REPLACE FUNCTION private.is_order_chat_participant(p_order_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_orders o
    LEFT JOIN public.stores s ON s.id = o.store_id
    LEFT JOIN public.riders r ON r.id = o.rider_id
    WHERE o.id = p_order_id
      AND (
        o.customer_id = auth.uid()
        OR s.owner_id = auth.uid()
        OR (o.rider_id IS NOT NULL AND r.user_id = auth.uid())
        OR private.has_role('admin')
      )
  );
$$;

ALTER TABLE public.order_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat participants read" ON public.order_chat_messages;
CREATE POLICY "chat participants read" ON public.order_chat_messages
  FOR SELECT TO authenticated
  USING (private.is_order_chat_participant(order_id));

DROP POLICY IF EXISTS "chat participants send" ON public.order_chat_messages;
CREATE POLICY "chat participants send" ON public.order_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND private.is_order_chat_participant(order_id));

-- Voice storage (private). First folder must be the order id.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat-voice', 'chat-voice', false, 3000000, ARRAY['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav'])
ON CONFLICT (id) DO UPDATE SET file_size_limit = 3000000,
  allowed_mime_types = ARRAY['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav'];

DROP POLICY IF EXISTS "chat participants upload voice" ON storage.objects;
CREATE POLICY "chat participants upload voice" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-voice'
    AND private.is_order_chat_participant((storage.foldername(name))[1])
    AND storage.extension(name) = ANY (ARRAY['webm', 'mp4', 'm4a', 'mp3', 'ogg', 'wav'])
  );

DROP POLICY IF EXISTS "chat participants play voice" ON storage.objects;
CREATE POLICY "chat participants play voice" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-voice'
    AND private.is_order_chat_participant((storage.foldername(name))[1])
  );

-- New message -> push the other participants (rides the existing send-push trigger).
CREATE OR REPLACE FUNCTION private.notify_order_chat_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_customer uuid;
  v_owner uuid;
  v_rider_user uuid;
  v_sender_label text;
  v_preview text;
BEGIN
  SELECT o.customer_id, s.owner_id, r.user_id
    INTO v_customer, v_owner, v_rider_user
  FROM public.delivery_orders o
  LEFT JOIN public.stores s ON s.id = o.store_id
  LEFT JOIN public.riders r ON r.id = o.rider_id
  WHERE o.id = NEW.order_id;
  v_sender_label := CASE NEW.sender_role
    WHEN 'customer' THEN 'ลูกค้า'
    WHEN 'store_owner' THEN 'ร้านค้า'
    WHEN 'rider' THEN 'ไรเดอร์'
    ELSE 'แอดมิน' END;
  v_preview := CASE WHEN NEW.kind = 'voice'
    THEN 'ส่งข้อความเสียง (' || COALESCE(NEW.voice_seconds, 0) || ' วินาที)'
    ELSE left(COALESCE(NEW.body, ''), 120) END;
  IF v_customer IS NOT NULL AND v_customer <> NEW.sender_id THEN
    INSERT INTO public.mobile_notifications (recipient_id, recipient_role, title, body, data, status)
    VALUES (v_customer, 'customer', 'ข้อความใหม่จาก' || v_sender_label, v_preview,
      jsonb_build_object('order_id', NEW.order_id, 'deep_link', './order.html?id=' || NEW.order_id), 'pending');
  END IF;
  IF v_owner IS NOT NULL AND v_owner <> NEW.sender_id THEN
    INSERT INTO public.mobile_notifications (recipient_id, recipient_role, title, body, data, status)
    VALUES (v_owner, 'store_owner', 'ข้อความใหม่จาก' || v_sender_label, v_preview,
      jsonb_build_object('order_id', NEW.order_id, 'deep_link', './orders.html'), 'pending');
  END IF;
  IF v_rider_user IS NOT NULL AND v_rider_user <> NEW.sender_id THEN
    INSERT INTO public.mobile_notifications (recipient_id, recipient_role, title, body, data, status)
    VALUES (v_rider_user, 'rider', 'ข้อความใหม่จาก' || v_sender_label, v_preview,
      jsonb_build_object('order_id', NEW.order_id, 'deep_link', './delivery.html?id=' || NEW.order_id), 'pending');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_order_chat ON public.order_chat_messages;
CREATE TRIGGER trg_notify_order_chat
AFTER INSERT ON public.order_chat_messages
FOR EACH ROW EXECUTE FUNCTION private.notify_order_chat_message();

-- Purge history when the order ends. Files go via chat-cleanup edge fn.
CREATE OR REPLACE FUNCTION private.purge_order_chat(p_order_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, net, public
AS $$
DECLARE
  v_secret text;
BEGIN
  DELETE FROM public.order_chat_messages WHERE order_id = p_order_id;
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'push_trigger_secret' LIMIT 1;
  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://abtsctwfkgzciseppach.supabase.co/functions/v1/chat-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('order_id', p_order_id)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION private.purge_chat_on_order_end()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('สำเร็จแล้ว', 'ยกเลิก', 'ยกเลิกแล้ว', 'คืนเงินแล้ว', 'คืนเงินบางส่วน') THEN
    PERFORM private.purge_order_chat(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purge_chat_on_order_end ON public.delivery_orders;
CREATE TRIGGER trg_purge_chat_on_order_end
AFTER UPDATE OF status ON public.delivery_orders
FOR EACH ROW EXECUTE FUNCTION private.purge_chat_on_order_end();

-- Safety net: daily purge of any leftover history on ended orders.
CREATE OR REPLACE FUNCTION private.cron_purge_order_chat()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT m.order_id
    FROM public.order_chat_messages m
    JOIN public.delivery_orders o ON o.id = m.order_id
    WHERE o.status IN ('สำเร็จแล้ว', 'ยกเลิก', 'ยกเลิกแล้ว', 'คืนเงินแล้ว', 'คืนเงินบางส่วน')
    LIMIT 20
  LOOP
    PERFORM private.purge_order_chat(r.order_id);
  END LOOP;
END;
$$;

SELECT cron.unschedule('purge-order-chat-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'purge-order-chat-daily');
SELECT cron.schedule('purge-order-chat-daily', '30 2 * * *', 'SELECT private.cron_purge_order_chat()');
