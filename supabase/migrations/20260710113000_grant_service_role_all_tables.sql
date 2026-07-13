-- service_role has no default grants on this project — 20260708111500 fixed
-- this for support_messages alone, but every table from the original
-- bulk-schema migration (profiles, user_roles, user_entitlements, posts,
-- outfits, purchases, ...) has the same gap: supabaseAdmin (service role)
-- gets "permission denied" on plain selects. Grant explicitly and set
-- default privileges so new tables don't repeat this.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
