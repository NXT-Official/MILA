-- Style goals: what the member wants their wardrobe to *do* ("Look more put
-- together", "Dress for a new role"). Kept out of color_profile because that
-- object is rebuilt wholesale on every re-calibration, which would wipe them.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS style_goals TEXT[] NOT NULL DEFAULT '{}';

-- The UI offers a fixed set, but the grant below lets the client write this
-- column directly, so the bound belongs in the database. No subqueries: CHECK
-- constraints can't contain them.
--
-- Idempotent without a DROP: the column already exists in production, so this
-- file must be safe to run against a database that already has the constraint.
-- ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS form, so the guard is a
-- pg_constraint lookup. (The version on allenDev dropped and re-added the
-- constraint; the end state is identical, and nothing is deleted here.)
-- src: https://www.postgresql.org/docs/15/sql-altertable.html · PostgreSQL 15 · 2026-10-07
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_style_goals_bounded'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_style_goals_bounded
      CHECK (
        cardinality(style_goals) <= 5
        AND array_position(style_goals, NULL::text) IS NULL
        AND octet_length(array_to_string(style_goals, ',')) <= 320
      );
  END IF;
END
$$;

-- Column-level grants are enumerated, so a new writable column has to be added
-- to both lists or the client's UPDATE is silently rejected.
GRANT INSERT (id, full_name, username, skin_undertone, color_season, body_type,
              color_profile, face_shape, hair_type, beauty_preferences,
              default_location, style_goals, updated_at),
      UPDATE (id, full_name, username, skin_undertone, color_season, body_type,
              color_profile, face_shape, hair_type, beauty_preferences,
              default_location, style_goals, updated_at)
  ON public.profiles TO authenticated;
