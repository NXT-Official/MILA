-- Saved daily palettes. The generated palette is stored whole as JSONB: it is a
-- snapshot of what the user pinned, not a live reference, so later edits to the
-- curated mixes must not change what someone already saved.

CREATE TABLE public.saved_palettes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  palette JSONB NOT NULL,
  style_vibe TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_palettes ENABLE ROW LEVEL SECURITY;

CREATE INDEX saved_palettes_user_created_idx
  ON public.saved_palettes(user_id, created_at DESC);

-- A palette is identified by its three colours, which is also how the UI
-- decides whether the current mix is already saved. Deliberately not a hash of
-- the whole row: `insight` is picked at random, so the same colours would
-- otherwise store twice.
CREATE UNIQUE INDEX saved_palettes_user_colors_idx ON public.saved_palettes(
  user_id,
  (palette ->> 'baseHex'),
  (palette ->> 'statementHex'),
  (palette ->> 'accentHex')
);

CREATE POLICY "Users view own saved palettes" ON public.saved_palettes
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users insert own saved palettes" ON public.saved_palettes
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users delete own saved palettes" ON public.saved_palettes
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);
