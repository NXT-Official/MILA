CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  username TEXT,
  skin_undertone TEXT CHECK (skin_undertone IN ('Cool','Warm','Neutral')),
  color_season TEXT CHECK (color_season IN ('Spring','Summer','Autumn','Winter')),
  body_type TEXT CHECK (body_type IN ('Hourglass','Rectangle','Pear','Inverted Triangle','Apple')),
  color_profile JSONB,
  face_shape TEXT,
  hair_type TEXT,
  beauty_preferences JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_location TEXT CHECK (default_location IS NULL OR length(default_location) <= 64),
  paddle_customer_id TEXT UNIQUE,
  suspended BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX profiles_username_lower_idx ON public.profiles (lower(username));

CREATE TABLE public.outfits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  analysis_result JSONB,
  match_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.outfits ENABLE ROW LEVEL SECURITY;

CREATE INDEX outfits_user_created_idx ON public.outfits(user_id, created_at DESC);

CREATE TABLE public.user_entitlements (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ads_removed BOOLEAN NOT NULL DEFAULT false,
  ai_credits INTEGER NOT NULL DEFAULT 0 CHECK (ai_credits >= 0),
  purchased_credits INTEGER NOT NULL DEFAULT 0 CHECK (purchased_credits >= 0),
  credits_reset_at DATE,
  look_image_pending BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
CREATE INDEX idx_products_palettes ON public.products USING GIN(seasonal_palettes);
CREATE INDEX idx_products_shapes ON public.products USING GIN(body_shapes);

CREATE TABLE public.user_favorites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_favorites_product ON public.user_favorites(product_id);

CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url_front TEXT NOT NULL,
  image_url_back TEXT NOT NULL,
  caption TEXT,
  generated_look_id UUID REFERENCES public.outfits(id) ON DELETE SET NULL,
  hidden BOOLEAN NOT NULL DEFAULT false,
  hidden_reason TEXT,
  hidden_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_posts_user_id ON public.posts(user_id);
CREATE INDEX idx_posts_created_at ON public.posts(created_at DESC);

CREATE TABLE public.post_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0 AND length(label) <= 100),
  category TEXT NOT NULL,
  attributes JSONB NOT NULL,
  bbox JSONB NOT NULL CHECK (
    jsonb_typeof(bbox -> 'x') = 'number' AND
    jsonb_typeof(bbox -> 'y') = 'number' AND
    jsonb_typeof(bbox -> 'w') = 'number' AND
    jsonb_typeof(bbox -> 'h') = 'number'
  ),
  source_url TEXT CHECK (source_url IS NULL OR source_url ~ '^https://'),
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.post_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX post_items_post_idx ON public.post_items(post_id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('help', 'feedback')),
  message TEXT NOT NULL CHECK (length(trim(message)) > 0 AND length(message) <= 2000),
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX support_messages_created_at_idx ON public.support_messages(created_at DESC);

CREATE TABLE public.staff_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_user_id UUID REFERENCES auth.users(id),
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX staff_audit_log_actor_created_idx
  ON public.staff_audit_log(actor_user_id, created_at DESC);

CREATE TABLE public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 60),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 280),
  price_amount INTEGER NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  billing_interval TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_interval IN ('monthly', 'yearly', 'one_time')),
  credits_included INTEGER NOT NULL DEFAULT 0 CHECK (credits_included >= 0),
  features TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  paddle_product_id TEXT,
  paddle_price_id TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_subscription_plans_active_sort
  ON public.subscription_plans (is_active, sort_order);

CREATE UNIQUE INDEX subscription_plans_single_featured_idx
  ON public.subscription_plans ((true))
  WHERE is_featured AND archived_at IS NULL;

CREATE UNIQUE INDEX subscription_plans_paddle_price_id_idx
  ON public.subscription_plans (paddle_price_id)
  WHERE paddle_price_id IS NOT NULL;

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  paddle_subscription_id TEXT NOT NULL UNIQUE,
  paddle_customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id, updated_at DESC);

CREATE TABLE public.concierge_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.concierge_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.concierge_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 8000),
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.concierge_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concierge_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX concierge_conversations_user_updated_idx
  ON public.concierge_conversations(user_id, updated_at DESC);
CREATE INDEX concierge_messages_conversation_created_idx
  ON public.concierge_messages(conversation_id, created_at);

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

CREATE UNIQUE INDEX saved_palettes_user_colors_idx ON public.saved_palettes(
  user_id,
  (palette ->> 'baseHex'),
  (palette ->> 'statementHex'),
  (palette ->> 'accentHex')
);

CREATE TABLE public.rate_limit_buckets (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE INDEX rate_limit_buckets_window_start_idx ON public.rate_limit_buckets (window_start);

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

CREATE OR REPLACE FUNCTION public.derive_username(desired text, email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  base text;
  candidate text;
  n int := 0;
BEGIN
  IF desired IS NOT NULL
     AND length(trim(desired)) BETWEEN 3 AND 30
     AND trim(desired) ~ '^[a-zA-Z0-9_-]+$'
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(trim(desired))) THEN
    RETURN trim(desired);
  END IF;

  base := left(regexp_replace(split_part(COALESCE(email, ''), '@', 1), '[^a-zA-Z0-9_-]', '', 'g'), 26);
  IF length(base) < 3 THEN base := 'member'; END IF;

  candidate := base;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(candidate)) LOOP
    n := n + 1;
    candidate := base || n::text;
  END LOOP;
  RETURN candidate;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.derive_username(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  candidate text := public.derive_username(NEW.raw_user_meta_data->>'username', NEW.email);
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, full_name, username)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), candidate);
  EXCEPTION WHEN unique_violation THEN
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

CREATE OR REPLACE FUNCTION public.manage_user_role(
  _actor_user_id UUID,
  _target_user_id UUID,
  _role public.app_role,
  _grant BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _changed BOOLEAN;
BEGIN
  IF _role NOT IN ('admin'::public.app_role, 'moderator'::public.app_role) THEN
    RAISE EXCEPTION 'invalid_staff_role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _actor_user_id AND r.role = 'admin' AND NOT p.suspended
  ) THEN
    RAISE EXCEPTION 'actor_not_admin';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target_user_id) THEN
    RAISE EXCEPTION 'target_not_found';
  END IF;

  IF _grant AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _target_user_id AND suspended
  ) THEN
    RAISE EXCEPTION 'target_suspended';
  END IF;

  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;

  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
    _changed := FOUND;
  ELSE
    IF _role = 'admin' AND EXISTS (
      SELECT 1
      FROM public.user_roles r
      JOIN public.profiles p ON p.id = r.user_id
      WHERE r.user_id = _target_user_id AND r.role = 'admin' AND NOT p.suspended
    ) AND (
      SELECT count(*)
      FROM public.user_roles r
      JOIN public.profiles p ON p.id = r.user_id
      WHERE r.role = 'admin' AND NOT p.suspended
    ) <= 1 THEN
      RAISE EXCEPTION 'last_active_steward';
    END IF;

    DELETE FROM public.user_roles
    WHERE user_id = _target_user_id AND role = _role;
    _changed := FOUND;
  END IF;

  INSERT INTO public.staff_audit_log (
    actor_user_id, action, target_user_id, target_type, target_id, metadata
  ) VALUES (
    _actor_user_id,
    CASE WHEN _grant THEN 'role.granted' ELSE 'role.revoked' END,
    _target_user_id,
    'user_role',
    _target_user_id::text,
    jsonb_build_object('role', _role, 'changed', _changed)
  );

  RETURN CASE
    WHEN _changed THEN 'changed'
    WHEN _grant THEN 'already_assigned'
    ELSE 'not_assigned'
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.manage_user_role(UUID, UUID, public.app_role, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_user_role(UUID, UUID, public.app_role, BOOLEAN)
  TO service_role;

CREATE OR REPLACE FUNCTION public.set_user_suspended(
  _actor_user_id UUID,
  _target_user_id UUID,
  _suspended BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _actor_user_id AND r.role = 'admin' AND NOT p.suspended
  ) THEN
    RAISE EXCEPTION 'actor_not_admin';
  END IF;

  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM public.profiles WHERE id = _target_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target_not_found'; END IF;

  IF _suspended AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _target_user_id AND role = 'admin'
  ) AND (
    SELECT count(*)
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.role = 'admin' AND NOT p.suspended
  ) <= 1 THEN
    RAISE EXCEPTION 'last_active_steward';
  END IF;

  UPDATE public.profiles SET suspended = _suspended WHERE id = _target_user_id;
  INSERT INTO public.staff_audit_log (
    actor_user_id, action, target_user_id, target_type, target_id
  ) VALUES (
    _actor_user_id,
    CASE WHEN _suspended THEN 'member.suspended' ELSE 'member.reinstated' END,
    _target_user_id,
    'member',
    _target_user_id::text
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_user_suspended(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_suspended(UUID, UUID, BOOLEAN)
  TO service_role;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _key TEXT, _limit INTEGER, _window_seconds INTEGER, _cost INTEGER DEFAULT 1
)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER, reset_at TIMESTAMPTZ, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _now TIMESTAMPTZ := clock_timestamp();
  _window_start TIMESTAMPTZ;
  _count INTEGER;
BEGIN
  IF _key IS NULL OR length(_key) = 0 OR length(_key) > 512 OR _limit <= 0 OR _window_seconds <= 0 OR _cost <= 0 THEN
    RAISE EXCEPTION 'invalid_rate_limit_params';
  END IF;

  INSERT INTO public.rate_limit_buckets AS rl (key, window_start, count, expires_at)
  VALUES (_key, _now, _cost, _now + make_interval(secs => _window_seconds))
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE WHEN rl.window_start <= _now - make_interval(secs => _window_seconds) THEN _now ELSE rl.window_start END,
    count = CASE WHEN rl.window_start <= _now - make_interval(secs => _window_seconds) THEN _cost ELSE rl.count + _cost END,
    expires_at = CASE WHEN rl.window_start <= _now - make_interval(secs => _window_seconds) THEN _now + make_interval(secs => _window_seconds) ELSE rl.expires_at END
  RETURNING window_start, count INTO _window_start, _count;

  RETURN QUERY SELECT _count <= _limit, GREATEST(0, _limit - _count),
    _window_start + make_interval(secs => _window_seconds),
    CASE WHEN _count > _limit THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_window_start + make_interval(secs => _window_seconds) - _now)))::int) ELSE 0 END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_ai_credit(
  _user_id UUID,
  _daily_allowance INTEGER
)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _today DATE := CURRENT_DATE;
  _daily INTEGER;
  _purchased INTEGER;
  _reset_at DATE;
BEGIN
  IF _daily_allowance IS NULL OR _daily_allowance < 0 THEN
    RAISE EXCEPTION 'invalid_daily_allowance';
  END IF;

  SELECT ai_credits, purchased_credits, credits_reset_at
    INTO _daily, _purchased, _reset_at
  FROM public.user_entitlements
  WHERE user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'entitlements_not_found';
  END IF;

  IF _reset_at IS DISTINCT FROM _today THEN
    _daily := _daily_allowance;
  END IF;

  IF _daily > 0 THEN
    _daily := _daily - 1;
  ELSIF _purchased > 0 THEN
    _purchased := _purchased - 1;
  ELSE
    UPDATE public.user_entitlements
    SET ai_credits = _daily, credits_reset_at = _today
    WHERE user_id = _user_id;
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  UPDATE public.user_entitlements
  SET ai_credits = _daily, purchased_credits = _purchased, credits_reset_at = _today
  WHERE user_id = _user_id;

  RETURN QUERY SELECT true, _daily + _purchased;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_ai_credit(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_credit(UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.grant_ai_credits(
  _user_id UUID,
  _daily_allowance INTEGER,
  _amount INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _today DATE := CURRENT_DATE;
  _daily INTEGER;
  _purchased INTEGER;
  _reset_at DATE;
BEGIN
  IF _daily_allowance IS NULL OR _daily_allowance < 0 THEN
    RAISE EXCEPTION 'invalid_daily_allowance';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT ai_credits, purchased_credits, credits_reset_at
    INTO _daily, _purchased, _reset_at
  FROM public.user_entitlements
  WHERE user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'entitlements_not_found';
  END IF;

  IF _reset_at IS DISTINCT FROM _today THEN
    _daily := _daily_allowance;
  END IF;

  _purchased := _purchased + _amount;

  UPDATE public.user_entitlements
  SET ai_credits = _daily, purchased_credits = _purchased, credits_reset_at = _today
  WHERE user_id = _user_id;

  RETURN _daily + _purchased;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_ai_credits(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_ai_credits(UUID, INTEGER, INTEGER) TO service_role;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_entitlements_updated_at
  BEFORE UPDATE ON public.user_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

REVOKE ALL ON public.user_roles             FROM authenticated;
REVOKE ALL ON public.user_entitlements      FROM authenticated;
REVOKE ALL ON public.purchases              FROM authenticated;
REVOKE ALL ON public.ad_events              FROM authenticated;
REVOKE ALL ON public.brands                 FROM authenticated;
REVOKE ALL ON public.products               FROM authenticated;
REVOKE ALL ON public.subscription_plans     FROM authenticated;
REVOKE ALL ON public.subscriptions          FROM authenticated;
REVOKE ALL ON public.support_messages       FROM authenticated;
REVOKE ALL ON public.staff_audit_log        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rate_limit_buckets     FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.user_roles, public.user_entitlements, public.purchases,
                public.ad_events, public.brands, public.products,
                public.subscription_plans, public.subscriptions
  TO authenticated;

GRANT SELECT, UPDATE (resolved) ON public.support_messages TO authenticated;

REVOKE ALL ON public.outfits, public.user_favorites, public.posts FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.outfits, public.user_favorites, public.posts TO authenticated;

REVOKE ALL ON public.post_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_items TO authenticated;

REVOKE ALL ON public.saved_palettes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.saved_palettes TO authenticated;

REVOKE ALL ON public.concierge_conversations, public.concierge_messages FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.concierge_conversations TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.concierge_messages TO authenticated;

REVOKE ALL ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT INSERT (id, full_name, username, skin_undertone, color_season, body_type,
              color_profile, face_shape, hair_type, beauty_preferences,
              default_location, updated_at),
      UPDATE (id, full_name, username, skin_undertone, color_season, body_type,
              color_profile, face_shape, hair_type, beauty_preferences,
              default_location, updated_at)
  ON public.profiles TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

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

CREATE POLICY "Users view own entitlements" ON public.user_entitlements
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users view own purchases" ON public.purchases
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users view own ad events" ON public.ad_events
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Authenticated can view active brands" ON public.brands
  FOR SELECT TO authenticated
  USING (status = 'active');

CREATE POLICY "Authenticated can view products" ON public.products
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users view own favorites" ON public.user_favorites
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users insert own favorites" ON public.user_favorites
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users delete own favorites" ON public.user_favorites
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

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

CREATE POLICY "Moderators manage all posts" ON public.posts
  FOR ALL TO authenticated
  USING ((select public.has_role(auth.uid(), 'moderator')))
  WITH CHECK ((select public.has_role(auth.uid(), 'moderator')));

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

CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR (select public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins view all support messages" ON public.support_messages
  FOR SELECT TO authenticated
  USING ((select public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins resolve support messages" ON public.support_messages
  FOR UPDATE TO authenticated
  USING ((select public.has_role(auth.uid(), 'admin')))
  WITH CHECK ((select public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Moderators view support messages" ON public.support_messages
  FOR SELECT TO authenticated
  USING ((select public.has_role(auth.uid(), 'moderator')));

CREATE POLICY "Moderators resolve support messages" ON public.support_messages
  FOR UPDATE TO authenticated
  USING ((select public.has_role(auth.uid(), 'moderator')))
  WITH CHECK ((select public.has_role(auth.uid(), 'moderator')));

CREATE POLICY "Authenticated view active plans" ON public.subscription_plans
  FOR SELECT TO authenticated
  USING (is_active AND archived_at IS NULL);

CREATE POLICY "Admins view all plans" ON public.subscription_plans
  FOR SELECT TO authenticated
  USING ((select public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Users view their own subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "Users view own concierge conversations" ON public.concierge_conversations
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users insert own concierge conversations" ON public.concierge_conversations
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users update own concierge conversations" ON public.concierge_conversations
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users delete own concierge conversations" ON public.concierge_conversations
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users view own concierge messages" ON public.concierge_messages
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users insert own concierge messages" ON public.concierge_messages
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users delete own concierge messages" ON public.concierge_messages
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users view own saved palettes" ON public.saved_palettes
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users insert own saved palettes" ON public.saved_palettes
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users delete own saved palettes" ON public.saved_palettes
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('outfits', 'outfits', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('posts', 'posts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Users view their own outfit images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'outfits' AND (storage.foldername(name))[1] = (select auth.uid())::text);

CREATE POLICY "Users can upload their own outfit images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'outfits' AND (storage.foldername(name))[1] = (select auth.uid())::text);

CREATE POLICY "Users can delete their own outfit images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'outfits' AND (storage.foldername(name))[1] = (select auth.uid())::text);

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

INSERT INTO public.profiles (id, full_name, username)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', ''),
       public.derive_username(u.raw_user_meta_data->>'username', u.email)
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

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

UPDATE auth.users SET
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
WHERE confirmation_token IS NULL OR recovery_token IS NULL
   OR email_change IS NULL OR email_change_token_new IS NULL
   OR email_change_token_current IS NULL OR phone_change IS NULL
   OR phone_change_token IS NULL OR reauthentication_token IS NULL;

WITH seed(email, password, username, full_name, role) AS (
  VALUES
    ('milaadmin@gmail.com', 'Milaadmin@00',
     'milaadmin', 'Mila Admin', 'admin'::public.app_role),
    ('milamoderator@gmail.com', 'Milamoderator@00',
     'milamoderator', 'Mila Moderator', 'moderator'::public.app_role),
    ('milauser@gmail.com', 'Milauser@00',
     'milauser', 'Mila User', 'user'::public.app_role)
),
reset AS (
  -- keep already-seeded accounts in sync with the passwords above
  UPDATE auth.users u
  SET encrypted_password = extensions.crypt(s.password, extensions.gen_salt('bf')),
      updated_at = now()
  FROM seed s
  WHERE u.email = s.email
),
created AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    -- GoTrue scans these into non-nullable Go strings; NULL breaks every user
    -- lookup with "Database error finding users". They must be '' , not NULL.
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  SELECT
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    s.email,
    extensions.crypt(s.password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', s.full_name, 'username', s.username),
    now(),
    now(),
    '', '', '', '', '', '', '', ''
  FROM seed s
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.email = s.email)
  RETURNING id, email
),
identities AS (
  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  )
  SELECT
    c.id::text,
    c.id,
    jsonb_build_object(
      'sub', c.id::text,
      'email', c.email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(),
    now(),
    now()
  FROM created c
  RETURNING user_id
)
INSERT INTO public.user_roles (user_id, role)
SELECT c.id, s.role FROM created c JOIN seed s ON s.email = c.email
UNION ALL
SELECT u.id, s.role FROM seed s JOIN auth.users u ON u.email = s.email
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.subscription_plans (
  slug, title, description, price_amount, billing_interval, credits_included,
  features, is_active, is_featured, sort_order, paddle_product_id, paddle_price_id
) VALUES
  ('starter', 'Starter',
   'Full access to the Mila studio. Plans differ only in your daily credits.',
   999, 'monthly', 10,
   ARRAY['Color & body profile', 'Outfit analysis', 'Concierge chat', 'Look image generation', 'Ad-free studio'],
   true, false, 1,
   'pro_01ky95cejdnzf8jv1k6tn13qhz', 'pri_01ky95cewyx235schggy6esrma'),
  ('style-pro', 'Style Pro',
   'Full access to the Mila studio. Plans differ only in your daily credits.',
   1999, 'monthly', 30,
   ARRAY['Color & body profile', 'Outfit analysis', 'Concierge chat', 'Look image generation', 'Ad-free studio'],
   true, true, 2,
   'pro_01ky95cfqgyr6h5tsnkffk5cr4', 'pri_01ky95cg0v8zkc8r6bsfa59378'),
  ('atelier-elite', 'Atelier Elite',
   'Full access to the Mila studio. Plans differ only in your daily credits.',
   14999, 'yearly', 100,
   ARRAY['Color & body profile', 'Outfit analysis', 'Concierge chat', 'Look image generation', 'Ad-free studio'],
   true, false, 3,
   'pro_01ky95cgb0a11ghkee1tx9mnsb', 'pri_01ky95cgkemj469nn9djdczah9')
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  price_amount = EXCLUDED.price_amount,
  billing_interval = EXCLUDED.billing_interval,
  credits_included = EXCLUDED.credits_included,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active,
  is_featured = EXCLUDED.is_featured,
  sort_order = EXCLUDED.sort_order,
  paddle_product_id = EXCLUDED.paddle_product_id,
  paddle_price_id = EXCLUDED.paddle_price_id,
  archived_at = NULL;
