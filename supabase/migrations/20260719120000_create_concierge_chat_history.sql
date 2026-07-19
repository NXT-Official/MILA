-- ============================================================================
-- Concierge chat history: persisted conversations and messages for Mila's
-- Styling Studio. Written directly by the authenticated client (owner-only
-- CRUD via RLS, same pattern as outfits).
-- ============================================================================
CREATE TABLE public.concierge_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.concierge_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.concierge_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 8000),
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.concierge_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concierge_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX concierge_conversations_user_updated_idx
  ON public.concierge_conversations(user_id, updated_at DESC);
CREATE INDEX concierge_messages_conversation_created_idx
  ON public.concierge_messages(conversation_id, created_at);

REVOKE ALL ON public.concierge_conversations FROM anon;
REVOKE ALL ON public.concierge_messages FROM anon;

-- This schema grants table privileges explicitly (no default privileges for
-- authenticated) — without these, every client query fails with 42501.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.concierge_conversations TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.concierge_messages TO authenticated;

-- ---------- concierge_conversations: owner-only CRUD ------------------------
CREATE POLICY "Users view own concierge conversations" ON public.concierge_conversations
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users insert own concierge conversations" ON public.concierge_conversations
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users update own concierge conversations" ON public.concierge_conversations
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users delete own concierge conversations" ON public.concierge_conversations
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ---------- concierge_messages: owner-only read/write ------------------------
CREATE POLICY "Users view own concierge messages" ON public.concierge_messages
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users insert own concierge messages" ON public.concierge_messages
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users delete own concierge messages" ON public.concierge_messages
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);
