-- ============================================================================
-- Support messages: anonymous "Studio Help Desk" / "Send Feedback" submissions
-- from the pre-login page. Written by the unauthenticated submitSupportMessage
-- server fn via the service role (no anon table access, consistent with the
-- rest of the schema); read/resolved by admins only.
-- ============================================================================
CREATE TABLE public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('help', 'feedback')),
  message TEXT NOT NULL CHECK (length(trim(message)) > 0 AND length(message) <= 2000),
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX support_messages_created_at_idx ON public.support_messages(created_at DESC);

-- No anon/authenticated grants: inserts happen via the service role from the
-- public server fn, reads/updates via the admin server fns (same pattern as
-- adminListUsers / adminHidePost). RLS policies below are defense in depth
-- for any client that queries the table directly with an admin session.
REVOKE ALL ON public.support_messages FROM anon;
GRANT SELECT, UPDATE (resolved) ON public.support_messages TO authenticated;

CREATE POLICY "Admins view all support messages" ON public.support_messages
  FOR SELECT TO authenticated
  USING ((select public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins resolve support messages" ON public.support_messages
  FOR UPDATE TO authenticated
  USING ((select public.has_role(auth.uid(), 'admin')))
  WITH CHECK ((select public.has_role(auth.uid(), 'admin')));
