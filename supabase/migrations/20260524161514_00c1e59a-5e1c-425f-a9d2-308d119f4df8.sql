
-- Tighten outfits bucket: replace public listing policy with owner-scoped one
DROP POLICY IF EXISTS "Outfit images are publicly viewable" ON storage.objects;

CREATE POLICY "Users view their own outfit images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'outfits' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Create wardrobe storage bucket (public-read via URL, owner-only write/list)
INSERT INTO storage.buckets (id, name, public)
VALUES ('wardrobe', 'wardrobe', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users view their own wardrobe images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'wardrobe' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users upload their own wardrobe images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'wardrobe' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users delete their own wardrobe images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'wardrobe' AND (storage.foldername(name))[1] = auth.uid()::text);
