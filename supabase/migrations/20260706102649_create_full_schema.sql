-- ============================================================================
-- 1. Types
-- ============================================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- ============================================================================
-- 2. Shared trigger function: updated_at maintenance
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ============================================================================
-- 3. Tables (dependency order)
-- ============================================================================

-- ---------- profiles -------------------------------------------------------
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  username TEXT,
  skin_undertone TEXT CHECK (skin_undertone IN ('Cool','Warm','Neutral')),
  -- Base season only; the detailed 16-season data lives inside color_profile
  color_season TEXT CHECK (color_season IN ('Spring','Summer','Autumn','Winter')),
  body_type TEXT CHECK (body_type IN ('Hourglass','Rectangle','Pear','Inverted Triangle','Apple')),
  color_profile JSONB,
  face_shape TEXT,
  hair_type TEXT,
  -- The app saves arrays of preference tags; readers tolerate objects too
  beauty_preferences JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Default Climate Sync Hub id slug (e.g. 'manila') from the app's HUBS
  -- constant; label/coords derive client-side. Lenient length guard on
  -- purpose — not an enum/FK, invalid values are simply ignored in the app.
  default_location TEXT CHECK (default_location IS NULL OR length(default_location) <= 64),
  -- Admin-controlled; column grants below prevent users from clearing it
  suspended BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Case-insensitive uniqueness ("Anna" and "anna" cannot coexist).
-- This is the only username unique index; it raises unique_violation
-- just like a plain UNIQUE constraint would.
CREATE UNIQUE INDEX profiles_username_lower_idx ON public.profiles (lower(username));

-- ---------- outfits ---------------------------------------------------------
CREATE TABLE public.outfits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Public URL into the outfits bucket (AI providers fetch it; see storage)
  image_url TEXT NOT NULL,
  analysis_result JSONB,
  match_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.outfits ENABLE ROW LEVEL SECURITY;

-- Serves the history view: filter by user, newest first
CREATE INDEX outfits_user_created_idx ON public.outfits(user_id, created_at DESC);

-- ---------- user_entitlements ----------------------------------------------
CREATE TABLE public.user_entitlements (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ads_removed BOOLEAN NOT NULL DEFAULT false,
  ai_credits INTEGER NOT NULL DEFAULT 5 CHECK (ai_credits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

-- ---------- purchases -------------------------------------------------------
CREATE TABLE public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Financial retention: nullable + ON DELETE SET NULL so purchase records
  -- survive account deletion (a RESTRICT FK would block auth.admin.deleteUser;
  -- CASCADE would destroy accounting history). The user link is severed,
  -- the record kept.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  product_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'completed',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_purchases_user ON public.purchases(user_id, created_at DESC);

-- ---------- ad_events -------------------------------------------------------
CREATE TABLE public.ad_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_type TEXT NOT NULL CHECK (ad_type IN ('banner','rewarded','interstitial')),
  event TEXT NOT NULL CHECK (event IN ('impression','click','completed','reward_granted','dismissed')),
  placement TEXT,
  reward_type TEXT,
  reward_amount INTEGER CHECK (reward_amount IS NULL OR reward_amount >= 0),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ad_events_user ON public.ad_events(user_id, created_at DESC);

-- ---------- brands ----------------------------------------------------------
CREATE TABLE public.brands (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  website_url TEXT,
  affiliate_network TEXT,
  commission_rate NUMERIC(5,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

-- ---------- products --------------------------------------------------------
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  affiliate_link TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  seasonal_palettes TEXT[] NOT NULL DEFAULT '{}',
  body_shapes TEXT[] NOT NULL DEFAULT '{}',
  category TEXT NOT NULL,
  date_added TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_products_brand ON public.products(brand_id);
CREATE INDEX idx_products_category ON public.products(category);
-- GIN indexes serve the dupe-hunter's palette/shape array matching
CREATE INDEX idx_products_palettes ON public.products USING GIN(seasonal_palettes);
CREATE INDEX idx_products_shapes ON public.products USING GIN(body_shapes);

-- ---------- user_favorites --------------------------------------------------
CREATE TABLE public.user_favorites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Also serves user_id lookups (leading column), so no separate user index
  UNIQUE (user_id, product_id)
);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

-- FK support: product deletes cascade into favorites
CREATE INDEX idx_favorites_product ON public.user_favorites(product_id);

-- ---------- posts -----------------------------------------------------------
CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Storage PATHS into the private posts bucket (signed at read time),
  -- not URLs. getFeed depends on this.
  image_url_front TEXT NOT NULL,
  image_url_back TEXT NOT NULL,
  caption TEXT,
  generated_look_id UUID REFERENCES public.outfits(id) ON DELETE SET NULL,
  -- Moderation (admin-only writes; hidden posts invisible to normal users)
  hidden BOOLEAN NOT NULL DEFAULT false,
  hidden_reason TEXT,
  hidden_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_posts_user_id ON public.posts(user_id);
CREATE INDEX idx_posts_created_at ON public.posts(created_at DESC);

-- ---------- user_roles ------------------------------------------------------
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. has_role — the single authorization primitive.
--    SECURITY DEFINER is required: RLS policies on user_roles itself call it,
--    and an invoker-rights version would recurse into RLS. It is safe because:
--    search_path is pinned, it only reads, and EXECUTE is revoked from anon
--    (Postgres grants EXECUTE to PUBLIC by default on new functions).
--    Signature must stay (_user_id, _role): admin.functions.ts calls it by
--    name via supabase.rpc("has_role", { _user_id, _role }).
--    Self-scoped: signed-in users get a real answer only for their own uid
--    (prevents probing who the admins are via /rest/v1/rpc/has_role); the
--    service role (auth.uid() IS NULL) may query anyone.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT ((select auth.uid()) = _user_id OR (select auth.uid()) IS NULL)
     AND EXISTS (
       SELECT 1
       FROM public.user_roles
       WHERE user_id = _user_id
         AND role = _role
     );
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- ============================================================================
-- 5. handle_new_user — one trigger provisions everything a new account needs:
--    profile (with validated username from signup metadata), default 'user'
--    role, and an entitlements row. SECURITY DEFINER + pinned search_path;
--    EXECUTE revoked from clients (only the auth.users trigger fires it).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  candidate text := NEW.raw_user_meta_data->>'username';
BEGIN
  -- username metadata is user-supplied: enforce the same rules as the RLS
  -- insert policy; drop it (rather than fail signup) if invalid or taken
  IF candidate IS NULL
     OR length(trim(candidate)) < 3
     OR length(trim(candidate)) > 30
     OR candidate !~ '^[a-zA-Z0-9_-]+$'
     OR EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(candidate)) THEN
    candidate := NULL;
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, full_name, username)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), candidate);
  EXCEPTION WHEN unique_violation THEN
    -- username race between the check above and the insert: never break signup
    INSERT INTO public.profiles (id, full_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
    ON CONFLICT (id) DO NOTHING;
  END;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_entitlements (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 6. updated_at triggers
-- ============================================================================
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_entitlements_updated_at
  BEFORE UPDATE ON public.user_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 7. Grants — defense in depth beneath RLS.
--    Supabase's default privileges hand ALL to anon/authenticated on new
--    tables; shape them explicitly instead. anon gets nothing (the app has
--    no unauthenticated data access). service_role keeps its defaults and
--    bypasses RLS.
-- ============================================================================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Read-only for clients (writes are service-role only)
REVOKE ALL ON public.user_roles         FROM authenticated;
REVOKE ALL ON public.user_entitlements  FROM authenticated;
REVOKE ALL ON public.purchases          FROM authenticated;
REVOKE ALL ON public.ad_events          FROM authenticated;
REVOKE ALL ON public.brands             FROM authenticated;
REVOKE ALL ON public.products           FROM authenticated;
GRANT SELECT ON public.user_roles, public.user_entitlements, public.purchases,
                public.ad_events, public.brands, public.products
  TO authenticated;

-- User-owned content: full DML, row-scoped by RLS
REVOKE ALL ON public.outfits, public.user_favorites, public.posts FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.outfits, public.user_favorites, public.posts TO authenticated;

-- profiles: column-level write grants. Without this a suspended user could
-- `update profiles set suspended = false` (the RLS WITH CHECK only validates
-- ownership + username). suspended and created_at are service-role/admin
-- only. id stays in the UPDATE grant because PostgREST upserts SET every
-- payload column including the PK; WITH CHECK (auth.uid() = id) prevents
-- actually changing it.
REVOKE ALL ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT INSERT (id, full_name, username, skin_undertone, color_season, body_type,
              color_profile, face_shape, hair_type, beauty_preferences,
              default_location, updated_at),
      UPDATE (id, full_name, username, skin_undertone, color_season, body_type,
              color_profile, face_shape, hair_type, beauty_preferences,
              default_location, updated_at)
  ON public.profiles TO authenticated;

-- ============================================================================
-- 8. RLS policies. Conventions: explicit TO authenticated, explicit
--    WITH CHECK on writes, and (select auth.uid()) / (select has_role(...))
--    so Postgres evaluates them once per query (initplan) instead of per row.
-- ============================================================================

-- ---------- profiles: own row only; admins may read all ---------------------
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = id);

CREATE POLICY "Admins view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING ((select public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = id
    AND username IS NOT NULL
    AND length(trim(username)) >= 3
    AND length(trim(username)) <= 30
    AND username ~ '^[a-zA-Z0-9_-]+$'
  );

CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK (
    (select auth.uid()) = id
    AND (
      username IS NULL
      OR (
        length(trim(username)) >= 3
        AND length(trim(username)) <= 30
        AND username ~ '^[a-zA-Z0-9_-]+$'
      )
    )
  );

-- ---------- outfits: owner-only CRUD ----------------------------------------
CREATE POLICY "Users view own outfits" ON public.outfits
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users insert own outfits" ON public.outfits
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users update own outfits" ON public.outfits
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users delete own outfits" ON public.outfits
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ---------- user_entitlements: read own; ALL writes via service role --------
-- No INSERT/UPDATE policies on purpose: credits and ads_removed are money.
CREATE POLICY "Users view own entitlements" ON public.user_entitlements
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

-- ---------- purchases: read own; created only by payment webhook ------------
-- No INSERT policy on purpose: client-created purchases = spoofing.
CREATE POLICY "Users view own purchases" ON public.purchases
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

-- ---------- ad_events: read own; written only by trusted ad callbacks -------
-- No INSERT policy on purpose: clients could otherwise mint
-- event='reward_granted' rows with arbitrary reward_amount.
CREATE POLICY "Users view own ad events" ON public.ad_events
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

-- ---------- brands / products: read-only catalog ----------------------------
CREATE POLICY "Authenticated can view active brands" ON public.brands
  FOR SELECT TO authenticated
  USING (status = 'active');

CREATE POLICY "Authenticated can view products" ON public.products
  FOR SELECT TO authenticated
  USING (true);

-- ---------- user_favorites: owner-only --------------------------------------
CREATE POLICY "Users view own favorites" ON public.user_favorites
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users insert own favorites" ON public.user_favorites
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users delete own favorites" ON public.user_favorites
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ---------- posts: social feed with moderation ------------------------------
-- Hidden posts are invisible to normal users; owners still see their own
-- (so "you posted today" checks and self-views keep working).
CREATE POLICY "Users can view everyone's posts" ON public.posts
  FOR SELECT TO authenticated
  USING (hidden = false OR (select auth.uid()) = user_id);

CREATE POLICY "Users can manage their own posts" ON public.posts
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Admins manage all posts" ON public.posts
  FOR ALL TO authenticated
  USING ((select public.has_role(auth.uid(), 'admin')))
  WITH CHECK ((select public.has_role(auth.uid(), 'admin')));

-- ---------- user_roles: read own (admins read all); NEVER client-writable ---
-- No INSERT/UPDATE/DELETE policies on purpose; role grants go through the
-- service role after an assertAdmin check (admin.functions.ts).
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR (select public.has_role(auth.uid(), 'admin')));

-- ============================================================================
-- 9. Storage
--    outfits bucket: PUBLIC on purpose. The app renders getPublicUrl() links
--    and external AI providers must fetch those URLs to analyze the image.
--    Privacy relies on unguessable userId/uuid paths; object listing is still
--    owner-scoped by policy.
--    posts bucket: PRIVATE. Feed images are delivered via short-lived signed
--    URLs created in getFeed with the caller's own session, which requires
--    the authenticated SELECT policy below — but anon/no-account access is
--    impossible, unlike a public bucket.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('outfits', 'outfits', true),
  ('posts', 'posts', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- outfits: owner-scoped (folder name = auth.uid())
CREATE POLICY "Users view their own outfit images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'outfits' AND (storage.foldername(name))[1] = (select auth.uid())::text);

CREATE POLICY "Users can upload their own outfit images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'outfits' AND (storage.foldername(name))[1] = (select auth.uid())::text);

CREATE POLICY "Users can delete their own outfit images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'outfits' AND (storage.foldername(name))[1] = (select auth.uid())::text);

-- posts: any authenticated user may read/sign (the feed is a shared social
-- surface and getFeed signs with the caller's session); writes stay
-- owner-scoped to the uploader's folder.
CREATE POLICY "Authenticated can view post images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'posts');

CREATE POLICY "Users can upload their own post images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'posts' AND (select auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own post images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'posts' AND (select auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'posts' AND (select auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own post images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'posts' AND (select auth.uid())::text = (storage.foldername(name))[1]);

-- ============================================================================
-- 10. Seed: affiliate catalog (dupe-hunter matches against these).
--     Guarded so re-running this file never duplicates the catalog.
-- ============================================================================
WITH b AS (
  INSERT INTO public.brands (name, website_url, affiliate_network, commission_rate, status)
  SELECT * FROM (VALUES
    ('Aritzia', 'https://www.aritzia.com', 'Rakuten', 5.00, 'active'),
    ('COS', 'https://www.cos.com', 'AWIN', 4.00, 'active'),
    ('Reformation', 'https://www.thereformation.com', 'Impact', 6.00, 'active'),
    ('Everlane', 'https://www.everlane.com', 'Impact', 5.00, 'active'),
    ('Ganni', 'https://www.ganni.com', 'AWIN', 6.00, 'active'),
    ('Net-a-Porter', 'https://www.net-a-porter.com', 'Rakuten', 8.00, 'active')
  ) AS v(name, website_url, affiliate_network, commission_rate, status)
  WHERE NOT EXISTS (SELECT 1 FROM public.brands)
  RETURNING id, name
)
INSERT INTO public.products (brand_id, title, image_url, affiliate_link, price, currency, seasonal_palettes, body_shapes, category)
SELECT b.id, p.title, p.image_url, p.affiliate_link, p.price, 'USD', p.palettes, p.shapes, p.category
FROM b JOIN (VALUES
  ('Aritzia','Effortless Wool Coat','https://images.unsplash.com/photo-1539533113208-f6df8cc8b543?w=800','https://www.aritzia.com',248.00,ARRAY['Deep Winter','Deep Autumn'],ARRAY['Hourglass','Rectangle'],'Outerwear'),
  ('Aritzia','Contour Knit Tank','https://images.unsplash.com/photo-1554568218-0f1715e72254?w=800','https://www.aritzia.com',48.00,ARRAY['Clear Winter','Cool Summer'],ARRAY['Hourglass','Pear'],'Tops'),
  ('COS','Architectural Trouser','https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=800','https://www.cos.com',135.00,ARRAY['Soft Summer','Cool Winter'],ARRAY['Rectangle','Inverted Triangle'],'Bottoms'),
  ('COS','Minimal Oversized Shirt','https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=800','https://www.cos.com',95.00,ARRAY['Light Summer','Soft Autumn'],ARRAY['Inverted Triangle','Apple'],'Tops'),
  ('Reformation','Bias Slip Midi Dress','https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=800','https://www.thereformation.com',248.00,ARRAY['Light Spring','Warm Spring'],ARRAY['Hourglass','Pear'],'Dresses'),
  ('Reformation','Linen High-Rise Short','https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800','https://www.thereformation.com',98.00,ARRAY['Warm Spring','Light Spring'],ARRAY['Pear','Hourglass'],'Bottoms'),
  ('Everlane','The Way-High Jean','https://images.unsplash.com/photo-1542272604-787c3835535d?w=800','https://www.everlane.com',98.00,ARRAY['Cool Winter','Soft Summer'],ARRAY['Rectangle','Pear'],'Bottoms'),
  ('Everlane','Organic Cotton Tee','https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800','https://www.everlane.com',30.00,ARRAY['Light Summer','Light Spring'],ARRAY['Hourglass','Rectangle','Pear','Inverted Triangle','Apple'],'Tops'),
  ('Ganni','Printed Mesh Top','https://images.unsplash.com/photo-1485518882345-15568b007407?w=800','https://www.ganni.com',175.00,ARRAY['Clear Spring','Clear Winter'],ARRAY['Hourglass','Inverted Triangle'],'Tops'),
  ('Ganni','Recycled Leather Skirt','https://images.unsplash.com/photo-1583496661160-fb5886a13d44?w=800','https://www.ganni.com',395.00,ARRAY['Deep Autumn','Deep Winter'],ARRAY['Hourglass','Pear'],'Bottoms'),
  ('Net-a-Porter','Cashmere Crewneck','https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800','https://www.net-a-porter.com',520.00,ARRAY['Soft Autumn','Soft Summer'],ARRAY['Rectangle','Hourglass'],'Tops'),
  ('Net-a-Porter','Silk Tailored Blazer','https://images.unsplash.com/photo-1591047139756-eb1a3a1a3a5b?w=800','https://www.net-a-porter.com',890.00,ARRAY['Deep Winter','Cool Winter'],ARRAY['Inverted Triangle','Hourglass'],'Outerwear')
) AS p(brand_name, title, image_url, affiliate_link, price, palettes, shapes, category)
ON b.name = p.brand_name;

-- ============================================================================
-- 11. Backfill — useful when auth users already exist (e.g. imported into
--     the fresh project) before this schema ran. No-op on a truly empty
--     project; safe to re-run.
-- ============================================================================
INSERT INTO public.profiles (id, full_name)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', '')
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'user'::public.app_role
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id)
ON CONFLICT DO NOTHING;

INSERT INTO public.user_entitlements (user_id)
SELECT u.id FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_entitlements e WHERE e.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- 12. First admin — uncomment and set the email after that account signs up.
--     Roles are otherwise granted only through the admin UI (service role).
-- ============================================================================
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users WHERE email = 'milaadmin@gmail.com'
ON CONFLICT DO NOTHING;
