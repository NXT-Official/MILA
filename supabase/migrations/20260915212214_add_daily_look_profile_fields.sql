-- Additive: profile fields for the coordinated daily-look feature — gender
-- (server-enforced makeup eligibility), hair length, makeup preference,
-- consented-photo bookkeeping, and freeform shopping/styling preferences.
ALTER TABLE public.profiles
  ADD COLUMN gender TEXT CHECK (gender IN ('Male','Female','Non-binary','Prefer not to say')),
  ADD COLUMN hair_length TEXT CHECK (hair_length IN ('Bald/Shaved','Short','Medium','Long')),
  ADD COLUMN makeup_preference TEXT NOT NULL DEFAULT 'none'
    CHECK (makeup_preference IN ('none','minimal','natural','defined')),
  ADD COLUMN photo_consent_at TIMESTAMPTZ,
  ADD COLUMN profile_photo_path TEXT,
  ADD COLUMN shopping_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN styling_constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN delivery_country TEXT CHECK (delivery_country IS NULL OR length(delivery_country) = 2);
