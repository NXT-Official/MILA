-- Moderator permissions stay limited to moderation and support. Member, role,
-- subscription, billing, and configuration access remains admin-only.

CREATE TABLE public.staff_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_user_id UUID REFERENCES auth.users(id),
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX staff_audit_log_actor_created_idx
  ON public.staff_audit_log(actor_user_id, created_at DESC);

REVOKE ALL ON public.staff_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.staff_audit_log TO service_role;

CREATE OR REPLACE FUNCTION public.manage_user_role(
  _actor_user_id UUID,
  _target_user_id UUID,
  _role public.app_role,
  _grant BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _changed BOOLEAN;
BEGIN
  IF _role NOT IN ('admin'::public.app_role, 'moderator'::public.app_role) THEN
    RAISE EXCEPTION 'invalid_staff_role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _actor_user_id AND r.role = 'admin' AND NOT p.suspended
  ) THEN
    RAISE EXCEPTION 'actor_not_admin';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target_user_id) THEN
    RAISE EXCEPTION 'target_not_found';
  END IF;

  IF _grant AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _target_user_id AND suspended
  ) THEN
    RAISE EXCEPTION 'target_suspended';
  END IF;

  -- Serialize staff changes so concurrent revocations cannot remove the final
  -- active Steward after independently passing the count check.
  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;

  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
    _changed := FOUND;
  ELSE
    IF _role = 'admin' AND EXISTS (
      SELECT 1
      FROM public.user_roles r
      JOIN public.profiles p ON p.id = r.user_id
      WHERE r.user_id = _target_user_id AND r.role = 'admin' AND NOT p.suspended
    ) AND (
      SELECT count(*)
      FROM public.user_roles r
      JOIN public.profiles p ON p.id = r.user_id
      WHERE r.role = 'admin' AND NOT p.suspended
    ) <= 1 THEN
      RAISE EXCEPTION 'last_active_steward';
    END IF;

    DELETE FROM public.user_roles
    WHERE user_id = _target_user_id AND role = _role;
    _changed := FOUND;
  END IF;

  INSERT INTO public.staff_audit_log (
    actor_user_id, action, target_user_id, target_type, target_id, metadata
  ) VALUES (
    _actor_user_id,
    CASE WHEN _grant THEN 'role.granted' ELSE 'role.revoked' END,
    _target_user_id,
    'user_role',
    _target_user_id::text,
    jsonb_build_object('role', _role, 'changed', _changed)
  );

  RETURN CASE
    WHEN _changed THEN 'changed'
    WHEN _grant THEN 'already_assigned'
    ELSE 'not_assigned'
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.manage_user_role(UUID, UUID, public.app_role, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_user_role(UUID, UUID, public.app_role, BOOLEAN)
  TO service_role;

CREATE OR REPLACE FUNCTION public.set_user_suspended(
  _actor_user_id UUID,
  _target_user_id UUID,
  _suspended BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _actor_user_id AND r.role = 'admin' AND NOT p.suspended
  ) THEN
    RAISE EXCEPTION 'actor_not_admin';
  END IF;

  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM public.profiles WHERE id = _target_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target_not_found'; END IF;

  IF _suspended AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _target_user_id AND role = 'admin'
  ) AND (
    SELECT count(*)
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.role = 'admin' AND NOT p.suspended
  ) <= 1 THEN
    RAISE EXCEPTION 'last_active_steward';
  END IF;

  UPDATE public.profiles SET suspended = _suspended WHERE id = _target_user_id;
  INSERT INTO public.staff_audit_log (
    actor_user_id, action, target_user_id, target_type, target_id
  ) VALUES (
    _actor_user_id,
    CASE WHEN _suspended THEN 'member.suspended' ELSE 'member.reinstated' END,
    _target_user_id,
    'member',
    _target_user_id::text
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_user_suspended(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_suspended(UUID, UUID, BOOLEAN)
  TO service_role;

-- Direct Data API access mirrors the same narrow operational scope. No
-- moderator policy is added to profiles, roles, entitlements, purchases, or
-- subscription plans.
CREATE POLICY "Moderators manage all posts" ON public.posts
  FOR ALL TO authenticated
  USING ((select public.has_role(auth.uid(), 'moderator')))
  WITH CHECK ((select public.has_role(auth.uid(), 'moderator')));

CREATE POLICY "Moderators view support messages" ON public.support_messages
  FOR SELECT TO authenticated
  USING ((select public.has_role(auth.uid(), 'moderator')));

CREATE POLICY "Moderators resolve support messages" ON public.support_messages
  FOR UPDATE TO authenticated
  USING ((select public.has_role(auth.uid(), 'moderator')))
  WITH CHECK ((select public.has_role(auth.uid(), 'moderator')));
