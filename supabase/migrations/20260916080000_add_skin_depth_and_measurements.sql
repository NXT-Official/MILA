-- Skin depth (lightness) is distinct from the existing skin_undertone
-- (warm/cool/neutral hue family) — a standard complementary pairing in
-- beauty-tech color systems. Height/weight are self-reported since they
-- can't be derived from a photo without a calibrated scale reference.
ALTER TABLE public.profiles
  ADD COLUMN skin_depth TEXT CHECK (skin_depth IN ('Fair', 'Light', 'Medium', 'Tan', 'Deep')),
  ADD COLUMN height_cm SMALLINT CHECK (height_cm BETWEEN 100 AND 250),
  ADD COLUMN weight_kg SMALLINT CHECK (weight_kg BETWEEN 30 AND 250);

-- profiles uses column-level GRANTs for UPDATE rather than a blanket table
-- grant (discovered the hard way earlier this session) — every new column
-- must extend this grant in the same migration that adds it.
GRANT UPDATE (skin_depth, height_cm, weight_kg) ON public.profiles TO authenticated;
