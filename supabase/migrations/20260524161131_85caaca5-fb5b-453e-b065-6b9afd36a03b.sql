-- Create the clothes table for digital wardrobe management
CREATE TABLE public.clothes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  primary_color TEXT,
  color_undertone TEXT,
  silhouette_tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.clothes ENABLE ROW LEVEL SECURITY;

-- Create policies so users can only manage their own wardrobe items
CREATE POLICY "Users can view their own clothes"
  ON public.clothes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own clothes"
  ON public.clothes
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own clothes"
  ON public.clothes
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own clothes"
  ON public.clothes
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Index for fast lookups by user
CREATE INDEX idx_clothes_user_id ON public.clothes(user_id);

-- Index for category filtering
CREATE INDEX idx_clothes_category ON public.clothes(category);