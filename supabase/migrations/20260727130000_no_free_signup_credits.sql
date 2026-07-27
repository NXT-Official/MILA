-- ============================================================================
-- New accounts start with zero AI credits.
--
-- handle_new_user() inserts a user_entitlements row using the column default,
-- so the default was handing every signup 5 free credits. Credits now come
-- only from a subscription plan or a purchased pack.
--
-- Existing rows are deliberately left alone: consume_ai_credit overwrites the
-- balance with the caller's daily allowance on the first call of each new day,
-- so free-tier users land on zero by themselves. Zeroing them here would also
-- destroy credits people have already paid for.
-- ============================================================================

ALTER TABLE public.user_entitlements
  ALTER COLUMN ai_credits SET DEFAULT 0;
