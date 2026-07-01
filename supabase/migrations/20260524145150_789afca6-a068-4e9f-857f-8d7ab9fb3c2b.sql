
-- Profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  skin_undertone TEXT CHECK (skin_undertone IN ('Cool','Warm','Neutral')),
  color_season TEXT CHECK (color_season IN ('Spring','Summer','Autumn','Winter')),
  body_type TEXT CHECK (body_type IN ('Hourglass','Rectangle','Pear','Inverted Triangle','Apple')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Outfits table
CREATE TABLE public.outfits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  analysis_result JSONB,
  match_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.outfits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own outfits" ON public.outfits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own outfits" ON public.outfits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own outfits" ON public.outfits FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own outfits" ON public.outfits FOR DELETE USING (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE INDEX outfits_user_created_idx ON public.outfits(user_id, created_at DESC);
