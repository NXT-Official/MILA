
-- Entitlements
CREATE TABLE public.user_entitlements (
  user_id UUID PRIMARY KEY,
  wardrobe_slots INTEGER NOT NULL DEFAULT 20,
  ads_removed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own entitlements" ON public.user_entitlements
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own entitlements" ON public.user_entitlements
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own entitlements" ON public.user_entitlements
  FOR UPDATE USING (auth.uid() = user_id);

-- Purchases (IAP record)
CREATE TABLE public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  product_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'completed',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own purchases" ON public.purchases
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own purchases" ON public.purchases
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_purchases_user ON public.purchases(user_id, created_at DESC);

-- Ad events (banner + rewarded)
CREATE TABLE public.ad_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ad_type TEXT NOT NULL CHECK (ad_type IN ('banner','rewarded','interstitial')),
  event TEXT NOT NULL CHECK (event IN ('impression','click','completed','reward_granted','dismissed')),
  placement TEXT,
  reward_type TEXT,
  reward_amount INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own ad events" ON public.ad_events
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own ad events" ON public.ad_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_ad_events_user ON public.ad_events(user_id, created_at DESC);
