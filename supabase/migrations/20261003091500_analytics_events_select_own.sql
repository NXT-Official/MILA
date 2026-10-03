-- The Style Profile "time for a refresh?" nudge (style-analysis-nudge.tsx)
-- needs the member's own last onboarding_completed date. The original
-- analytics_events migration was deliberately insert-only, which made that
-- client read fail with 403. Members may now read their own rows — row access
-- stays scoped to the caller via RLS, and admin reads still go through the
-- service-role client.
GRANT SELECT ON public.analytics_events TO authenticated;

CREATE POLICY "analytics_events_select_own" ON public.analytics_events
  FOR SELECT
  USING ((select auth.uid()) = user_id);
