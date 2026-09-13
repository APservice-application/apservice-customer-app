-- B3: client-ready push registry. Firebase config comes from the user later;
-- the table + RLS land now so APPush client code has a save target.
CREATE TABLE IF NOT EXISTS public.push_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app text NOT NULL CHECK (app IN ('customer', 'merchant', 'rider', 'admin')),
  token text NOT NULL CHECK (char_length(token) BETWEEN 10 AND 4096),
  platform text NOT NULL DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, app, token)
);
CREATE INDEX IF NOT EXISTS push_device_tokens_user_app_idx
  ON public.push_device_tokens (user_id, app);

ALTER TABLE public.push_device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own push tokens" ON public.push_device_tokens;
CREATE POLICY "users manage own push tokens" ON public.push_device_tokens
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "admins read push tokens" ON public.push_device_tokens;
CREATE POLICY "admins read push tokens" ON public.push_device_tokens
  FOR SELECT TO authenticated
  USING (private.has_role('admin'));
