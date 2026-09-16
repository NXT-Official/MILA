-- ai_spend_log has an RLS policy (ai_spend_log_insert_own) but was never
-- given the underlying table-level GRANT INSERT for authenticated. RLS only
-- restricts rows within privileges already granted — without the GRANT,
-- every insert is rejected with 42501 regardless of the RLS policy passing.
-- Confirmed live in production runtime logs: "permission denied for table
-- ai_spend_log" on every AI call, silently swallowed by logAiSpend's
-- try/catch (spend tracking broken, not user-facing, but real).
GRANT INSERT ON public.ai_spend_log TO authenticated;
