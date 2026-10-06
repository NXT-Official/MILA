-- Founding colour read marker (QA MW-10).
--
-- The founding (first, free) colour read used to be inferred from
-- profiles.skin_undertone / color_season / color_profile — all member-writable
-- columns — so a member could clear their own columns through PostgREST and
-- repeat the free AI read indefinitely (bounded only by the 10/hour rate
-- limit). Whether the founding read happened is now recorded in a column that
-- members have no write grant on: it is written only by the service role.
--
-- Existing members who already hold a colour dossier are backfilled as
-- "founding read used" so nobody keeps an extra free read because of the
-- switch; members without a dossier keep NULL and keep their one free read.

alter table public.profiles
  add column if not exists founding_color_read_at timestamptz;

comment on column public.profiles.founding_color_read_at is
  'When the once-ever free founding colour read produced a dossier (service-role write only). NULL = founding read still available. QA MW-10.';

update public.profiles
set founding_color_read_at = coalesce(updated_at, now())
where founding_color_read_at is null
  and skin_undertone is not null
  and color_season is not null
  and color_profile is not null
  and color_profile::text not in ('null', '{}');
