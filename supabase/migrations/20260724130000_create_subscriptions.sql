-- ============================================================================
-- subscriptions — mirrors Paddle subscription state into Supabase.
--
-- Populated exclusively by the Paddle webhook handler (service role); no
-- user-facing writes. user_id -> profiles (not auth.users), matching the
-- FK convention used by concierge_messages, so it's joinable from the
-- generated Supabase types.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN paddle_customer_id TEXT UNIQUE;

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  paddle_subscription_id TEXT NOT NULL UNIQUE,
  paddle_customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id, updated_at DESC);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Grants — service_role already has ALL via 20260710113000's default
-- privileges; authenticated users are read-only on their own rows.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.subscriptions FROM anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;

CREATE POLICY "Users view their own subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policies on purpose: every write goes through the
-- service role from the Paddle webhook handler
-- (src/lib/paddle-webhook.server.ts).
