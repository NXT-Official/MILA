-- Bring ai_spend_log_insert_own in line with the (select auth.uid()) pattern
-- used everywhere else in the schema, so Postgres caches the value once per
-- statement instead of re-evaluating auth.uid() per row.
DROP POLICY IF EXISTS "ai_spend_log_insert_own" ON public.ai_spend_log;

CREATE POLICY "ai_spend_log_insert_own" ON public.ai_spend_log
  FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);
