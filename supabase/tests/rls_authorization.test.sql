-- ============================================================================
-- RLS / grants negative + positive tests (pgTAP).
--
-- Run with the Supabase CLI against a local stack:
--   supabase start
--   supabase test db
--
-- NOT executed as part of this audit: this sandbox has no Docker/Supabase
-- CLI available (verified: `docker info` and `supabase --version` both fail
-- here), so these assertions are reviewed by inspection only. Run them
-- before deploying any of this branch's migrations. See
-- docs/security/SECURITY_AUDIT.md for the verification-gap note.
--
-- Technique: since this project has no supabase_test_helpers extension
-- installed, each actor is simulated with the standard low-level pattern —
-- set request.jwt.claims then SET ROLE — rather than a helper library.
-- ============================================================================

BEGIN;
SELECT plan(23);

-- ---------------------------------------------------------------------------
-- Fixtures: two members, one moderator, one admin, one suspended member.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'member-a@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'member-b@test.local'),
  ('00000000-0000-0000-0000-000000000003', 'moderator@test.local'),
  ('00000000-0000-0000-0000-000000000004', 'admin@test.local'),
  ('00000000-0000-0000-0000-000000000005', 'suspended@test.local');

INSERT INTO public.profiles (id, username, suspended) VALUES
  ('00000000-0000-0000-0000-000000000001', 'member_a', false),
  ('00000000-0000-0000-0000-000000000002', 'member_b', false),
  ('00000000-0000-0000-0000-000000000003', 'moderator_x', false),
  ('00000000-0000-0000-0000-000000000004', 'admin_x', false),
  ('00000000-0000-0000-0000-000000000005', 'suspended_x', true)
ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, suspended = EXCLUDED.suspended;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000003', 'moderator'),
  ('00000000-0000-0000-0000-000000000004', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.posts (id, user_id, image_url_front, image_url_back, hidden, hidden_reason) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'a/f.jpg', 'a/b.jpg', false, null),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'b/f.jpg', 'b/b.jpg', true, 'policy violation')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscription_plans (id, slug, title, price_amount, currency, is_active) VALUES
  ('20000000-0000-0000-0000-000000000001', 'starter', 'Starter', 999, 'usd', true)
ON CONFLICT (id) DO NOTHING;

-- Helper: switch the simulated actor.
CREATE OR REPLACE FUNCTION pg_temp.act_as(_user_id uuid, _role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user_id)::text, true);
  EXECUTE format('SET ROLE %I', _role);
END;
$$;

-- ---------------------------------------------------------------------------
-- 1) Anonymous cannot write plan data.
-- ---------------------------------------------------------------------------
SET ROLE anon;
PREPARE anon_insert_plan AS
  INSERT INTO public.subscription_plans (slug, title) VALUES ('anon-plan', 'x');
SELECT throws_ok('anon_insert_plan', '42501', NULL, 'anon cannot insert subscription_plans');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2) Members cannot create/feature/retire plans.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000001');
PREPARE member_insert_plan AS
  INSERT INTO public.subscription_plans (slug, title) VALUES ('member-plan', 'x');
SELECT throws_ok('member_insert_plan', '42501', NULL, 'member cannot insert subscription_plans');

PREPARE member_update_plan AS
  UPDATE public.subscription_plans SET is_featured = true
  WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT throws_ok('member_update_plan', '42501', NULL, 'member cannot update subscription_plans');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3) Members cannot change their own role or suspension state.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000001');
PREPARE member_insert_role AS
  INSERT INTO public.user_roles (user_id, role)
  VALUES ('00000000-0000-0000-0000-000000000001', 'admin');
SELECT throws_ok('member_insert_role', '42501', NULL, 'member cannot insert into user_roles');

PREPARE member_set_suspended AS
  UPDATE public.profiles SET suspended = true
  WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT lives_ok('member_set_suspended', 'update on own profile is allowed by RLS...');
SELECT is(
  (SELECT suspended FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
  false,
  '...but the suspended column grant blocks the value from actually changing'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4) Moderators cannot perform administrator-only actions (roles/suspension).
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000003');
PREPARE moderator_insert_role AS
  INSERT INTO public.user_roles (user_id, role)
  VALUES ('00000000-0000-0000-0000-000000000001', 'admin');
SELECT throws_ok('moderator_insert_role', '42501', NULL, 'moderator cannot insert into user_roles');

SELECT throws_ok(
  format(
    'SELECT public.manage_user_role(%L::uuid, %L::uuid, %L::public.app_role, true)',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'admin'
  ),
  '42501',
  NULL,
  'moderator cannot execute manage_user_role (service-role only)'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5) Members cannot read hidden posts directly; moderators can.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000001');
SELECT is(
  (SELECT count(*)::int FROM public.posts WHERE id = '10000000-0000-0000-0000-000000000002'),
  0,
  'member A cannot see member B''s hidden post'
);
RESET ROLE;

SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000003');
SELECT is(
  (SELECT count(*)::int FROM public.posts WHERE id = '10000000-0000-0000-0000-000000000002'),
  1,
  'moderator can see the hidden post'
);
SELECT is(
  (SELECT hidden_reason FROM public.posts WHERE id = '10000000-0000-0000-0000-000000000002'),
  'policy violation',
  'moderator can read the moderation reason'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6) Support messages: not readable/writable by anon or plain members.
--    Seeded as the table owner (bypasses RLS/grants) since only the
--    service role may insert in production (submitSupportMessage).
-- ---------------------------------------------------------------------------
INSERT INTO public.support_messages (kind, message) VALUES ('help', 'seed row for test');

SET ROLE anon;
PREPARE anon_insert_support AS
  INSERT INTO public.support_messages (kind, message) VALUES ('help', 'anon spam');
SELECT throws_ok('anon_insert_support', '42501', NULL, 'anon cannot insert support_messages');
SELECT is(
  (SELECT count(*)::int FROM public.support_messages),
  0,
  'anon has no support_messages grant (RLS aside, PostgREST-level denial)'
);
RESET ROLE;

SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000001');
PREPARE member_insert_support AS
  INSERT INTO public.support_messages (kind, message) VALUES ('help', 'member spam');
SELECT throws_ok('member_insert_support', '42501', NULL, 'member cannot insert support_messages directly');
SELECT is(
  (SELECT count(*)::int FROM public.support_messages),
  0,
  'member cannot read support_messages (no SELECT policy for plain members)'
);
RESET ROLE;

SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000004');
SELECT ok(
  (SELECT count(*)::int FROM public.support_messages) >= 1,
  'admin can read support_messages'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7) Audit log is append-only: no UPDATE/DELETE for anyone but service_role.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000004');
PREPARE admin_delete_audit AS DELETE FROM public.staff_audit_log;
SELECT throws_ok('admin_delete_audit', '42501', NULL, 'admin cannot delete staff_audit_log rows directly');
RESET ROLE;

SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000003');
PREPARE moderator_delete_audit AS DELETE FROM public.staff_audit_log;
SELECT throws_ok('moderator_delete_audit', '42501', NULL, 'moderator cannot delete staff_audit_log rows');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 8) rate_limit_buckets is not readable or writable by any client role.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000004');
PREPARE admin_read_rate_limits AS SELECT * FROM public.rate_limit_buckets;
SELECT throws_ok('admin_read_rate_limits', '42501', NULL, 'admin cannot read rate_limit_buckets directly');

PREPARE admin_call_rate_limit_fn AS SELECT * FROM public.check_rate_limit('x', 1, 60);
SELECT throws_ok('admin_call_rate_limit_fn', '42501', NULL, 'admin cannot execute check_rate_limit (service-role only)');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 9) A user cannot update another user's profile.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000001');
PREPARE member_a_updates_member_b AS
  UPDATE public.profiles SET full_name = 'hijacked'
  WHERE id = '00000000-0000-0000-0000-000000000002';
SELECT lives_ok('member_a_updates_member_b', 'the UPDATE statement itself does not error...');
SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000002'),
  NULL,
  '...but the USING clause means zero rows are actually affected'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 10) AI credits (user_entitlements) cannot be written by members directly.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000001');
PREPARE member_updates_own_credits AS
  UPDATE public.user_entitlements SET ai_credits = 999999
  WHERE user_id = '00000000-0000-0000-0000-000000000001';
SELECT throws_ok('member_updates_own_credits', '42501', NULL, 'member cannot update user_entitlements (no UPDATE grant)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
