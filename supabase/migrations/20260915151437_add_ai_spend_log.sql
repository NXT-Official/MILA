-- Additive: real per-call AI spend tracking, starting with OpenRouter image
-- generation. Every call to an AI provider that reports usage cost writes one
-- row here — this is a spend ledger, not aggregated stats (those are derived
-- from this table on the admin side).
CREATE TABLE public.ai_spend_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  cost_usd NUMERIC(10,6),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_spend_log ENABLE ROW LEVEL SECURITY;

-- A user can write their own spend row (server functions insert on their
-- behalf using the request-scoped, RLS-bound client) but never read anyone's
-- spend data, including their own — this is an internal cost ledger, not a
-- user-facing feature. Only the service-role client (admin console) reads it.
CREATE POLICY "ai_spend_log_insert_own" ON public.ai_spend_log
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_ai_spend_log_created ON public.ai_spend_log(created_at DESC);
CREATE INDEX idx_ai_spend_log_provider ON public.ai_spend_log(provider);
