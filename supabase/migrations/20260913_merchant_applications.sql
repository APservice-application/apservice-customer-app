-- Merchant self-registration: public applies via edge (service role),
-- admin approves (provisions store) or rejects. Login is blocked while
-- an application is pending/rejected (checked in role-access login).
CREATE TABLE IF NOT EXISTS public.merchant_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_name text NOT NULL CHECK (char_length(store_name) BETWEEN 2 AND 160),
  owner_name text NOT NULL CHECK (char_length(owner_name) BETWEEN 2 AND 160),
  phone text NOT NULL CHECK (phone ~ '^[0-9]{9,10}$'),
  email text NOT NULL,
  login_id text NOT NULL,
  address text NOT NULL DEFAULT '' CHECK (char_length(address) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note text NOT NULL DEFAULT '',
  store_id text NULL REFERENCES public.stores(id) ON DELETE SET NULL,
  reviewed_by uuid NULL,
  reviewed_at timestamptz NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (login_id),
  UNIQUE (email),
  UNIQUE (phone)
);
CREATE INDEX IF NOT EXISTS merchant_applications_status_idx
  ON public.merchant_applications (status, submitted_at DESC);

ALTER TABLE public.merchant_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "applicants read own" ON public.merchant_applications;
CREATE POLICY "applicants read own" ON public.merchant_applications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role('admin'));

DROP POLICY IF EXISTS "admins manage applications" ON public.merchant_applications;
CREATE POLICY "admins manage applications" ON public.merchant_applications
  FOR ALL TO authenticated
  USING (private.has_role('admin'))
  WITH CHECK (private.has_role('admin'));
