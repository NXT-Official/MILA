-- Every generation lands in the member's history automatically. A look saved
-- before its visual exists (and a look composed by a member without photo
-- consent, which never gets one) carries no image — the row's visual is
-- optional now. The column was NOT NULL from the original schema.
alter table public.outfits alter column image_url drop not null;
