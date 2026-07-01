ALTER TABLE public.user_entitlements
  ADD COLUMN IF NOT EXISTS ai_credits integer NOT NULL DEFAULT 5;

UPDATE public.user_entitlements SET ai_credits = 5 WHERE ai_credits IS NULL;