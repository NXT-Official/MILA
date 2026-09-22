-- "Users view own concierge messages" RLS policy filters on user_id, but
-- only conversation_id was indexed. Without this, every read forces Postgres
-- to fall back to a sequential scan for the RLS predicate as message volume
-- grows across all users, not just the caller's own rows.
CREATE INDEX IF NOT EXISTS concierge_messages_user_id_idx
  ON public.concierge_messages(user_id);
