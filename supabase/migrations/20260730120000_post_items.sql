-- Clothing pieces detected in an OOTD post. Detection runs once when the post is
-- created and is stored here, so rendering a feed of 20 posts costs zero vision
-- calls. `attributes` is the whole ClothingAttributes blob the vision model
-- returned: the drawer feeds it straight back into the dupe matcher, so it is a
-- snapshot rather than a reference.

CREATE TABLE public.post_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0 AND length(label) <= 100),
  category TEXT NOT NULL,
  attributes JSONB NOT NULL,
  -- Normalized 0-1 {x,y,w,h} so a hotspot lands on the garment at any render size.
  -- The server clamps the ranges; this only rejects structurally wrong shapes.
  bbox JSONB NOT NULL CHECK (
    jsonb_typeof(bbox -> 'x') = 'number' AND
    jsonb_typeof(bbox -> 'y') = 'number' AND
    jsonb_typeof(bbox -> 'w') = 'number' AND
    jsonb_typeof(bbox -> 'h') = 'number'
  ),
  -- Poster-supplied, therefore untrusted. https only, enforced here as well as in
  -- the server function, because `authenticated` can reach this table directly.
  source_url TEXT CHECK (source_url IS NULL OR source_url ~ '^https://'),
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.post_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX post_items_post_idx ON public.post_items(post_id);

-- Visibility deliberately delegates to posts: the EXISTS subquery is itself
-- filtered by the posts SELECT policy, so hidden posts, ownership and the
-- moderator/admin overrides all stay in one place instead of being restated.
CREATE POLICY "Post items are visible with their post" ON public.post_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id));

CREATE POLICY "Post owners manage their post items" ON public.post_items
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.user_id = (select auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.user_id = (select auth.uid()))
  );

-- RLS is checked after the GRANT, so without this `authenticated` gets 42501
-- before any policy runs (see the saved_palettes grants migration).
REVOKE ALL ON public.post_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_items TO authenticated;
