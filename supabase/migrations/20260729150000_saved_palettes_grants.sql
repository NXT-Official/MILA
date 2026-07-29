-- saved_palettes was created with RLS policies but no table-level privileges.
-- RLS filters rows *after* Postgres checks the GRANT, so `authenticated` was
-- getting 42501 permission denied before any policy was consulted. This schema
-- grants explicitly per table (see the outfits/posts block in the initial
-- migration) and ALTER DEFAULT PRIVILEGES here only covers service_role, so a
-- new table starts with nothing for end users.

REVOKE ALL ON public.saved_palettes FROM PUBLIC, anon, authenticated;

-- No UPDATE: a saved palette is an immutable snapshot, and there is no
-- corresponding UPDATE policy.
GRANT SELECT, INSERT, DELETE ON public.saved_palettes TO authenticated;
