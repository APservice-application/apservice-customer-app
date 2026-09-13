-- A4: refund-proofs bucket was referenced by the refund RPC but never created,
-- so mark_paid with proof always failed. Mirror withdrawal-proofs (admin-only).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('refund-proofs', 'refund-proofs', false, 1000000, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET file_size_limit = 1000000,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "admins read refund proofs" ON storage.objects;
CREATE POLICY "admins read refund proofs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'refund-proofs' AND private.has_role('admin'));

DROP POLICY IF EXISTS "admins upload refund proofs" ON storage.objects;
CREATE POLICY "admins upload refund proofs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'refund-proofs' AND private.has_role('admin')
    AND storage.extension(name) = ANY (ARRAY['jpg', 'jpeg', 'png', 'webp']));
