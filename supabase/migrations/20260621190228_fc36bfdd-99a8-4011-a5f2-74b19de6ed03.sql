-- Expand profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS face_shape text,
  ADD COLUMN IF NOT EXISTS hair_type text,
  ADD COLUMN IF NOT EXISTS beauty_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Posts table
CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url_front text NOT NULL,
  image_url_back text NOT NULL,
  caption text,
  generated_look_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own posts"
  ON public.posts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view everyone's posts"
  ON public.posts
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_posts_user_id ON public.posts(user_id);
CREATE INDEX idx_posts_created_at ON public.posts(created_at DESC);

-- Storage policies for posts bucket (bucket itself created via storage tool)
CREATE POLICY "Posts images are publicly viewable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'posts');

CREATE POLICY "Users can upload their own post images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'posts' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own post images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'posts' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own post images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'posts' AND auth.uid()::text = (storage.foldername(name))[1]);
