-- support_messages was created without an explicit service_role grant,
-- relying on default privileges that didn't carry over for this table
-- (unlike the original bulk-schema migration). supabaseAdmin (service role)
-- needs INSERT/SELECT/UPDATE to write and read it directly.
GRANT ALL ON public.support_messages TO service_role;
