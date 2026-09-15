-- The `profiles` table uses column-level GRANTs for UPDATE (not a blanket
-- table-level grant), so `ALTER TABLE ... ADD COLUMN` alone did not make the
-- new Phase-1 columns writable by the `authenticated` role. This left every
-- onboarding write to these fields failing with 42501 insufficient_privilege.
GRANT UPDATE (
  gender,
  hair_length,
  makeup_preference,
  shopping_preferences,
  styling_constraints,
  delivery_country,
  photo_consent_at,
  profile_photo_path
) ON public.profiles TO authenticated;
