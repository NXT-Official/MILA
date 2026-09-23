-- Self-built product analytics: user_id-attributed events written directly
-- by the web and mobile clients at a small, deliberate set of funnel steps
-- (signup, onboarding complete, look generated, purchase started). Insert-
-- only for authenticated callers, no client SELECT — same shape as
-- ai_spend_log's proven-correct RLS pattern (this migration mirrors it
-- exactly, including the (select auth.uid()) perf pattern). Admin reads go
-- through MILA_ADMIN's service-role client, same as every other analytics
-- source table.
CREATE TABLE public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL CHECK (length(event_name) > 0 AND length(event_name) <= 100),
  source TEXT NOT NULL CHECK (source IN ('web', 'mobile')),
  properties JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.analytics_events FROM PUBLIC, anon;
GRANT INSERT ON public.analytics_events TO authenticated;

CREATE POLICY "analytics_events_insert_own" ON public.analytics_events
  FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

CREATE INDEX idx_analytics_events_created ON public.analytics_events(created_at DESC);
CREATE INDEX idx_analytics_events_name_created ON public.analytics_events(event_name, created_at DESC);
CREATE INDEX idx_analytics_events_user_id ON public.analytics_events(user_id);
