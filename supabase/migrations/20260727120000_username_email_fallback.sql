-- New accounts got username = NULL whenever the requested handle was taken or
-- malformed, so the app fell back to "Member" everywhere the profile row is the
-- source of truth (member profile page, feed author names, admin table).
-- Derive a unique handle from the email local part instead.

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

-- Backfill the accounts already stuck on NULL.
DO $$
DECLARE
  row record;
BEGIN
  FOR row IN
    SELECT p.id, u.email, u.raw_user_meta_data->>'username' AS desired
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.username IS NULL
  LOOP
    UPDATE public.profiles
    SET username = public.derive_username(row.desired, row.email)
    WHERE id = row.id;
  END LOOP;
END;
$$;
