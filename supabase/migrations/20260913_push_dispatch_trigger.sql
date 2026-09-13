-- B3 full: every mobile_notifications insert fans out to send-push (FCM).
-- The shared secret lives in vault (name: push_trigger_secret), never in this file.
-- Push must never break notification inserts: all failures fall through.
CREATE OR REPLACE FUNCTION private.dispatch_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, net, public
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'push_trigger_secret' LIMIT 1;
  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;
  PERFORM net.http_post(
    url := 'https://abtsctwfkgzciseppach.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('notification_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_push ON public.mobile_notifications;
CREATE TRIGGER trg_dispatch_push
AFTER INSERT ON public.mobile_notifications
FOR EACH ROW EXECUTE FUNCTION private.dispatch_push_notification();
