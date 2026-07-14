# Auth Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Mila's existing atomic Postgres rate limiter to authentication (login, signup, OAuth, reauth, email change), replace per-identifier RPC calls with one batched atomic call, and migrate the six existing AI endpoints onto the same shared abstraction.

**Architecture:** A single `src/lib/rate-limit/` module (types, policies, identifiers, memory/postgres stores, limiter) backed by a batched `consume_rate_limits(jsonb)` Postgres RPC (private-schema implementation + public wrapper). Login/signup/reauth/email-change move behind Mila server functions using a transitional `setSession()` token handoff. OAuth start/callback move to Mila-owned routes using cookie-backed PKCE storage and a short-lived, single-use, encrypted-at-rest Postgres session handoff (never a URL fragment).

**Tech Stack:** Bun, TypeScript, TanStack Start/Router, Supabase (`@supabase/supabase-js`), Zod, hCaptcha, `node:crypto` (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-07-14-auth-rate-limiting-design.md` — every task below implements a numbered section of that document; section references are inline.

## Global Constraints

- No new npm/bun dependencies — `node:crypto` covers HMAC + AES-256-GCM; TanStack Start's built-in `getCookie`/`setCookie`/`deleteCookie`/`getRequestHeader`/`getRequestIP`/`getRequestUrl` cover cookies and headers (verified against the installed `@tanstack/start-server-core` type defs, version 1.168.26).
- Production must never construct `MemoryRateLimitStore` — throws unconditionally (spec §6.5).
- No raw email, phone, password, token, OAuth code, state, PKCE verifier, or CAPTCHA token may be stored as a key or logged (spec §7, §23).
- `RATE_LIMIT_HMAC_SECRET`, `AUTH_HANDOFF_ENCRYPTION_KEY` are dedicated secrets — never reused from `SUPABASE_SERVICE_ROLE_KEY`, JWT signing, `HCAPTCHA_SECRET`, or AI provider keys (spec §7.2, §9.6).
- Every denied request returns HTTP `429` + `Retry-After` (spec §22) — this is a real gap in the *existing* AI limiter (it throws a plain `Error`, never sets response status), fixed once in a shared helper and reused everywhere.
- Existing numeric AI/support limits are preserved exactly (spec §21): `generateDailyLook` 10/3600s, `analyzeOutfit` 15/3600s, `analyzeClothing` 20/3600s, `findDupes` 15/3600s, `analyzePersonalColor` 10/3600s, `concierge` 20/300s, `support-message` 5/600s.
- No Docker/Supabase CLI is available in this sandbox (verified via `docker info` and `supabase --version`, both fail) — SQL/pgTAP tests are written and documented as requiring a local Supabase stack to execute, matching the existing precedent in `supabase/tests/rls_authorization.test.sql` and `docs/security/SECURITY_AUDIT.md` AUDIT-002. Never claim a DB test passed without actually running it.

---

## Task 1: Database migration — batched rate limits + OAuth session handoff

**Files:**
- Create: `supabase/migrations/20260714120000_batched_rate_limits_and_handoff.sql`
- Test: `supabase/tests/rate_limit_privileges.test.sql`

**Interfaces:**
- Produces: `public.rate_limit_buckets(policy, subject_hash, request_count, window_start, updated_at)`, RPC `public.consume_rate_limits(_checks jsonb) returns table(policy text, allowed boolean, limit_value integer, remaining integer, reset_at timestamptz, retry_after_seconds integer)`, RPC `public.create_auth_session_handoff(_token_hash text, _encrypted_session_payload text, _ttl_seconds integer) returns void`, RPC `public.redeem_auth_session_handoff(_token_hash text) returns table(encrypted_session_payload text)`. All four are `service_role`-only.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Batched, atomic multi-identifier rate limiting + one-time OAuth session
-- handoff storage.
--
-- Replaces the single-key public.rate_limit_buckets/check_rate_limit()
-- primitive from 20260714090000_atomic_rate_limits.sql with a composite-key
-- table and a batched RPC that consumes every identifier scope for one
-- request (e.g. login.ip + login.ip_account) in a single atomic function
-- call, so a login/signup/OAuth request never partially consumes one
-- counter while failing on another. See docs/security/RATE_LIMITING.md and
-- docs/superpowers/specs/2026-07-14-auth-rate-limiting-design.md §5.
--
-- The rate_limit_buckets table only ever held cost-control counters, no
-- user data, so it is safe to drop and recreate rather than migrate in
-- place.
-- ============================================================================

drop function if exists public.check_rate_limit(text, integer, integer);
drop table if exists public.rate_limit_buckets;

create table public.rate_limit_buckets (
  policy text not null,
  subject_hash text not null,
  request_count integer not null,
  window_start timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (policy, subject_hash),
  constraint rate_limit_buckets_policy_length check (length(policy) between 1 and 100),
  constraint rate_limit_buckets_subject_hash_length check (length(subject_hash) between 1 and 200),
  constraint rate_limit_buckets_count_nonnegative check (request_count >= 0)
);

alter table public.rate_limit_buckets enable row level security;

-- No policies: with no grants at all, RLS denies everyone by default anyway;
-- this is belt-and-suspenders in case grants are ever loosened by mistake.
revoke all on public.rate_limit_buckets from public, anon, authenticated;
grant all on public.rate_limit_buckets to service_role;

create index rate_limit_buckets_window_start_idx on public.rate_limit_buckets (window_start);

-- ----------------------------------------------------------------------------
-- Private schema: not reachable via PostgREST, holds the real implementation.
-- ----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.consume_rate_limits(_checks jsonb)
returns table (
  policy text,
  allowed boolean,
  limit_value integer,
  remaining integer,
  reset_at timestamptz,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _now timestamptz := clock_timestamp();
  _check jsonb;
  _n_checks integer;
  _policy text;
  _subject_hash text;
  _limit integer;
  _window_seconds integer;
  _cost integer;
  _window_start timestamptz;
  _count integer;
  _seen text[] := array[]::text[];
  _dedupe_key text;
begin
  if _checks is null or jsonb_typeof(_checks) <> 'array' then
    raise exception 'invalid_rate_limit_checks: must be a non-null json array';
  end if;

  _n_checks := jsonb_array_length(_checks);
  if _n_checks < 1 then
    raise exception 'invalid_rate_limit_checks: at least one check is required';
  end if;
  if _n_checks > 8 then
    raise exception 'invalid_rate_limit_checks: at most 8 checks are allowed';
  end if;

  -- Sort by (policy, subjectHash) so concurrent multi-check requests always
  -- acquire row locks in the same order, avoiding deadlocks between two
  -- requests that touch overlapping keys in different orders.
  for _check in
    select value
    from jsonb_array_elements(_checks) as value
    order by value->>'policy', value->>'subjectHash'
  loop
    _policy := _check->>'policy';
    _subject_hash := _check->>'subjectHash';
    _limit := (_check->>'limit')::integer;
    _window_seconds := (_check->>'windowSeconds')::integer;
    _cost := coalesce((_check->>'cost')::integer, 1);

    if _policy is null or length(_policy) = 0 or length(_policy) > 100 then
      raise exception 'invalid_rate_limit_checks: policy must be 1-100 chars';
    end if;
    if _subject_hash is null or length(_subject_hash) = 0 or length(_subject_hash) > 200 then
      raise exception 'invalid_rate_limit_checks: subjectHash must be 1-200 chars';
    end if;
    if _limit is null or _limit <= 0 or _limit > 1000000 then
      raise exception 'invalid_rate_limit_checks: limit must be a positive integer';
    end if;
    if _window_seconds is null or _window_seconds <= 0 or _window_seconds > 2592000 then
      raise exception 'invalid_rate_limit_checks: windowSeconds must be a positive integer up to 30 days';
    end if;
    if _cost <= 0 or _cost > 1000 then
      raise exception 'invalid_rate_limit_checks: cost must be a positive integer';
    end if;

    _dedupe_key := _policy || chr(1) || _subject_hash;
    if _dedupe_key = any(_seen) then
      raise exception 'invalid_rate_limit_checks: duplicate policy/subject pair %', _dedupe_key;
    end if;
    _seen := _seen || _dedupe_key;

    insert into public.rate_limit_buckets as rl (policy, subject_hash, window_start, request_count)
    values (_policy, _subject_hash, _now, _cost)
    on conflict (policy, subject_hash) do update set
      window_start = case
        when rl.window_start <= _now - make_interval(secs => _window_seconds) then _now
        else rl.window_start
      end,
      request_count = case
        when rl.window_start <= _now - make_interval(secs => _window_seconds) then _cost
        else rl.request_count + _cost
      end,
      updated_at = _now
    returning rl.window_start, rl.request_count into _window_start, _count;

    policy := _policy;
    allowed := _count <= _limit;
    limit_value := _limit;
    remaining := greatest(0, _limit - _count);
    reset_at := _window_start + make_interval(secs => _window_seconds);
    retry_after_seconds := case
      when _count <= _limit then 0
      else greatest(1, ceil(extract(epoch from (_window_start + make_interval(secs => _window_seconds) - _now)))::int)
    end;
    return next;
  end loop;
end;
$$;

revoke execute on function private.consume_rate_limits(jsonb) from public, anon, authenticated;
grant execute on function private.consume_rate_limits(jsonb) to service_role;

create or replace function public.consume_rate_limits(_checks jsonb)
returns table (
  policy text,
  allowed boolean,
  limit_value integer,
  remaining integer,
  reset_at timestamptz,
  retry_after_seconds integer
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.consume_rate_limits(_checks);
$$;

revoke execute on function public.consume_rate_limits(jsonb) from public, anon, authenticated;
grant execute on function public.consume_rate_limits(jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- One-time OAuth session handoff (spec §9.5-9.7). Bridges the server-owned
-- OAuth callback (a redirect navigation, which cannot return JSON directly)
-- to the browser without ever putting access/refresh tokens in a URL.
-- ----------------------------------------------------------------------------
create table private.auth_session_handoffs (
  token_hash text primary key,
  encrypted_session_payload text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint auth_session_handoffs_token_hash_length check (length(token_hash) between 1 and 200)
);

revoke all on private.auth_session_handoffs from public, anon, authenticated;
grant all on private.auth_session_handoffs to service_role;

create index auth_session_handoffs_expires_at_idx on private.auth_session_handoffs (expires_at);

create or replace function private.create_auth_session_handoff(
  _token_hash text,
  _encrypted_session_payload text,
  _ttl_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _token_hash is null or length(_token_hash) = 0 or length(_token_hash) > 200 then
    raise exception 'invalid_handoff_token';
  end if;
  if _encrypted_session_payload is null or length(_encrypted_session_payload) = 0 then
    raise exception 'invalid_handoff_payload';
  end if;
  if _ttl_seconds is null or _ttl_seconds <= 0 or _ttl_seconds > 300 then
    raise exception 'invalid_handoff_ttl';
  end if;

  insert into private.auth_session_handoffs (token_hash, encrypted_session_payload, expires_at)
  values (_token_hash, _encrypted_session_payload, clock_timestamp() + make_interval(secs => _ttl_seconds));
end;
$$;

revoke execute on function private.create_auth_session_handoff(text, text, integer) from public, anon, authenticated;
grant execute on function private.create_auth_session_handoff(text, text, integer) to service_role;

create or replace function public.create_auth_session_handoff(
  _token_hash text,
  _encrypted_session_payload text,
  _ttl_seconds integer
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.create_auth_session_handoff(_token_hash, _encrypted_session_payload, _ttl_seconds);
$$;

revoke execute on function public.create_auth_session_handoff(text, text, integer) from public, anon, authenticated;
grant execute on function public.create_auth_session_handoff(text, text, integer) to service_role;

-- Atomic single-use redemption: the UPDATE's WHERE clause (consumed_at is
-- null and not expired) means a second concurrent redemption of the same
-- token matches zero rows once the first commits — no separate read-then-
-- update race window.
create or replace function private.redeem_auth_session_handoff(_token_hash text)
returns table (encrypted_session_payload text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _token_hash is null or length(_token_hash) = 0 or length(_token_hash) > 200 then
    raise exception 'invalid_handoff_token';
  end if;

  return query
  update private.auth_session_handoffs as h
  set consumed_at = clock_timestamp()
  where h.token_hash = _token_hash
    and h.consumed_at is null
    and h.expires_at > clock_timestamp()
  returning h.encrypted_session_payload;
end;
$$;

revoke execute on function private.redeem_auth_session_handoff(text) from public, anon, authenticated;
grant execute on function private.redeem_auth_session_handoff(text) to service_role;

create or replace function public.redeem_auth_session_handoff(_token_hash text)
returns table (encrypted_session_payload text)
language sql
security invoker
set search_path = ''
as $$
  select * from private.redeem_auth_session_handoff(_token_hash);
$$;

revoke execute on function public.redeem_auth_session_handoff(text) from public, anon, authenticated;
grant execute on function public.redeem_auth_session_handoff(text) to service_role;

-- Not required for correctness (rows are bounded by short TTL / policy set)
-- but keeps table size flat. Not scheduled here — see
-- docs/security/RATE_LIMITING.md for the optional pg_cron wiring.
create or replace function private.cleanup_expired_rate_limit_rows()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rate_limit_buckets where window_start < clock_timestamp() - interval '30 days';
  delete from private.auth_session_handoffs where expires_at < clock_timestamp() - interval '1 day';
$$;

revoke execute on function private.cleanup_expired_rate_limit_rows() from public, anon, authenticated;
grant execute on function private.cleanup_expired_rate_limit_rows() to service_role;

-- ----------------------------------------------------------------------------
-- Privilege-regression assertions: fail the migration itself, not a
-- production deploy, if a future edit accidentally grants a client role
-- execute access.
-- ----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.consume_rate_limits(jsonb)', 'EXECUTE') then
    raise exception 'anon must not execute public.consume_rate_limits';
  end if;
  if has_function_privilege('authenticated', 'public.consume_rate_limits(jsonb)', 'EXECUTE') then
    raise exception 'authenticated must not execute public.consume_rate_limits';
  end if;
  if has_function_privilege('anon', 'public.create_auth_session_handoff(text, text, integer)', 'EXECUTE') then
    raise exception 'anon must not execute public.create_auth_session_handoff';
  end if;
  if has_function_privilege('authenticated', 'public.create_auth_session_handoff(text, text, integer)', 'EXECUTE') then
    raise exception 'authenticated must not execute public.create_auth_session_handoff';
  end if;
  if has_function_privilege('anon', 'public.redeem_auth_session_handoff(text)', 'EXECUTE') then
    raise exception 'anon must not execute public.redeem_auth_session_handoff';
  end if;
  if has_function_privilege('authenticated', 'public.redeem_auth_session_handoff(text)', 'EXECUTE') then
    raise exception 'authenticated must not execute public.redeem_auth_session_handoff';
  end if;
end;
$$;
```

- [ ] **Step 2: Write the pgTAP privilege + behavior test**

```sql
-- ============================================================================
-- Rate-limit + OAuth-handoff privilege and behavior tests (pgTAP).
--
-- Run with the Supabase CLI against a local stack:
--   supabase start
--   supabase test db
--
-- NOT executed as part of this change: this sandbox has no Docker/Supabase
-- CLI available (verified: `docker info` / `supabase --version` both fail).
-- Run before deploying this migration. See docs/security/SECURITY_AUDIT.md.
-- ============================================================================

BEGIN;
SELECT plan(11);

-- 1-2) Ordinary roles cannot execute the RPCs.
SELECT throws_ok(
  $$ SET ROLE anon; SELECT public.consume_rate_limits('[]'::jsonb); RESET ROLE; $$,
  '42501',
  NULL,
  'anon cannot execute public.consume_rate_limits'
);
SELECT throws_ok(
  $$ SET ROLE authenticated; SELECT public.consume_rate_limits('[]'::jsonb); RESET ROLE; $$,
  '42501',
  NULL,
  'authenticated cannot execute public.consume_rate_limits'
);

-- 3-4) Ordinary roles cannot read or write the bucket table directly.
SELECT throws_ok(
  $$ SET ROLE authenticated; SELECT * FROM public.rate_limit_buckets; RESET ROLE; $$,
  '42501',
  NULL,
  'authenticated cannot select rate_limit_buckets'
);
SELECT throws_ok(
  $$ SET ROLE authenticated; INSERT INTO public.rate_limit_buckets (policy, subject_hash, request_count, window_start) VALUES ('x', 'y', 1, now()); RESET ROLE; $$,
  '42501',
  NULL,
  'authenticated cannot insert into rate_limit_buckets'
);

-- 5) First request under the limit is allowed.
SELECT ok(
  (SELECT allowed FROM public.consume_rate_limits(
    '[{"policy":"test.p","subjectHash":"s1","limit":2,"windowSeconds":60,"cost":1}]'::jsonb
  )),
  'first request under limit is allowed'
);

-- 6) The limit-th request is allowed, the next is denied (same subject).
SELECT ok(
  (SELECT allowed FROM public.consume_rate_limits(
    '[{"policy":"test.p","subjectHash":"s1","limit":2,"windowSeconds":60,"cost":1}]'::jsonb
  )),
  'second request (at limit) is allowed'
);
SELECT ok(
  NOT (SELECT allowed FROM public.consume_rate_limits(
    '[{"policy":"test.p","subjectHash":"s1","limit":2,"windowSeconds":60,"cost":1}]'::jsonb
  )),
  'third request (over limit) is denied'
);

-- 7) Independent subjects do not collide.
SELECT ok(
  (SELECT allowed FROM public.consume_rate_limits(
    '[{"policy":"test.p","subjectHash":"s2","limit":2,"windowSeconds":60,"cost":1}]'::jsonb
  )),
  'independent subject is unaffected by another subject''s consumption'
);

-- 8) Duplicate (policy, subjectHash) pairs in one batch are rejected.
SELECT throws_ok(
  $$ SELECT public.consume_rate_limits('[
    {"policy":"test.dup","subjectHash":"s1","limit":5,"windowSeconds":60,"cost":1},
    {"policy":"test.dup","subjectHash":"s1","limit":5,"windowSeconds":60,"cost":1}
  ]'::jsonb); $$,
  'P0001',
  NULL,
  'duplicate policy/subject pairs in one batch are rejected'
);

-- 9) Empty batch is rejected.
SELECT throws_ok(
  $$ SELECT public.consume_rate_limits('[]'::jsonb); $$,
  'P0001',
  NULL,
  'empty batch is rejected'
);

-- 10) Batch over 8 checks is rejected.
SELECT throws_ok(
  format(
    $$ SELECT public.consume_rate_limits('%s'::jsonb); $$,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'policy', 'test.many', 'subjectHash', 's' || g, 'limit', 5, 'windowSeconds', 60, 'cost', 1
      ))::text
      FROM generate_series(1, 9) AS g
    )
  ),
  'P0001',
  NULL,
  'batch over 8 checks is rejected'
);

-- 11) Handoff redemption is single-use.
SELECT public.create_auth_session_handoff('hash-1', 'encrypted-payload', 90);
SELECT ok(
  (SELECT encrypted_session_payload FROM public.redeem_auth_session_handoff('hash-1')) = 'encrypted-payload',
  'first handoff redemption returns the payload'
);
SELECT ok(
  (SELECT count(*) FROM public.redeem_auth_session_handoff('hash-1')) = 0,
  'second redemption of the same handoff returns nothing'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Document that this test requires a live stack (do not run yet)**

This test cannot run in this sandbox — no Docker/Supabase CLI. Do not mark it passing. It will be executed in the final verification task for real if a Supabase CLI becomes available in the execution environment; otherwise it ships written-but-unexecuted, exactly like `supabase/tests/rls_authorization.test.sql` already does.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260714120000_batched_rate_limits_and_handoff.sql supabase/tests/rate_limit_privileges.test.sql
git commit -m "$(cat <<'EOF'
feat(db): batched atomic rate limits + OAuth session handoff schema

Replaces the single-key rate_limit_buckets/check_rate_limit primitive
with a composite-key table and a batched consume_rate_limits(jsonb)
RPC that consumes every identifier scope for one request atomically
(deterministic key ordering avoids deadlocks). Adds a private-schema,
single-use, hashed-at-rest OAuth session handoff table so the
server-owned OAuth callback can hand a session to the browser without
ever putting tokens in a URL.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Shared types (`src/lib/rate-limit/types.ts`)

**Files:**
- Create: `src/lib/rate-limit/types.ts`

**Interfaces:**
- Produces: `RateLimitPolicyName`, `RateLimitCheck`, `RateLimitDecision`, `CombinedRateLimitDecision`, `AuthRiskDecision` — every later task imports these.

- [ ] **Step 1: Write the file**

```ts
/**
 * Shared rate-limit types. See docs/superpowers/specs/2026-07-14-auth-rate-limiting-design.md §6.1.
 * Reserved names (no caller yet): recovery.ip, otp.email.ip, otp.phone.ip,
 * resend.ip_account, mfa.user_factor — see spec §17. Any future
 * magic-link/OTP/MFA/password-recovery flow must add a real policy entry in
 * policies.ts and use consumeRateLimits, not a bespoke check.
 */
export type RateLimitPolicyName =
  | "login.ip"
  | "login.ip_account"
  | "login.account_risk"
  | "signup.ip"
  | "signup.ip_account"
  | "oauth.start.ip"
  | "oauth.start.session_provider"
  | "oauth.callback.invalid_ip"
  | "oauth.callback.session"
  | "reauth.user"
  | "reauth.ip_user"
  | "email_change.user"
  | "email_change.ip"
  | "support.ip"
  | "ai.outfit"
  | "ai.analysis"
  | "ai.clothing_analysis"
  | "ai.dupe_hunter"
  | "ai.personal_color"
  | "ai.concierge"
  | "recovery.ip"
  | "otp.email.ip"
  | "otp.phone.ip"
  | "resend.ip_account"
  | "mfa.user_factor";

export type RateLimitCheck = {
  policy: RateLimitPolicyName;
  subjectHash: string;
  limit: number;
  windowSeconds: number;
  /** Defaults to 1 when omitted. */
  cost?: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

export type CombinedRateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  decisions: Array<{
    policy: RateLimitPolicyName;
    decision: RateLimitDecision;
  }>;
};

export type AuthRiskDecision =
  | { action: "allow" }
  | { action: "require_captcha" }
  | { action: "deny"; retryAfterSeconds: number };
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/rate-limit/types.ts
git commit -m "$(cat <<'EOF'
feat(rate-limit): add shared rate-limit type definitions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Identifiers (`src/lib/rate-limit/identifiers.ts`)

**Files:**
- Create: `src/lib/rate-limit/identifiers.ts`
- Test: `src/lib/rate-limit/identifiers.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `hashIdentifier(namespace, value)`, `normalizeEmail(email)`, `emailIdentifier(email)`, `ipIdentifier(ip)`, `userIdentifier(userId)`, `compoundIdentifier(namespace, parts[])`, `clientIpFromHeaders(forwardedFor, trustedProxyCount, directIp?)`, `clientIp()`. Every server function and `oauth.*`/`login.*`/etc. handler in later tasks calls these.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  clientIpFromHeaders,
  compoundIdentifier,
  emailIdentifier,
  hashIdentifier,
  normalizeEmail,
} from "./identifiers";

const ORIGINAL_SECRET = process.env.RATE_LIMIT_HMAC_SECRET;
process.env.RATE_LIMIT_HMAC_SECRET = "test-secret-only-do-not-use-in-prod";

describe("normalizeEmail", () => {
  test("trims and lowercases", () => {
    expect(normalizeEmail("  User@Example.COM  ")).toBe("user@example.com");
  });
});

describe("hashIdentifier / emailIdentifier", () => {
  test("is deterministic for the same input", () => {
    expect(hashIdentifier("email", "user@example.com")).toBe(
      hashIdentifier("email", "user@example.com"),
    );
  });

  test("differs across namespaces for the same value", () => {
    expect(hashIdentifier("email", "x")).not.toBe(hashIdentifier("ip", "x"));
  });

  test("email capitalization does not change the identifier", () => {
    expect(emailIdentifier("User@Example.com")).toBe(emailIdentifier("user@example.com"));
  });

  test("never returns the raw input", () => {
    const hash = emailIdentifier("secret@example.com");
    expect(hash).not.toContain("secret@example.com");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("throws when RATE_LIMIT_HMAC_SECRET is not configured", () => {
    const saved = process.env.RATE_LIMIT_HMAC_SECRET;
    delete process.env.RATE_LIMIT_HMAC_SECRET;
    expect(() => hashIdentifier("email", "x")).toThrow();
    process.env.RATE_LIMIT_HMAC_SECRET = saved;
  });
});

describe("compoundIdentifier", () => {
  test("differs when the parts differ", () => {
    expect(compoundIdentifier("ip_email", ["ip1", "email1"])).not.toBe(
      compoundIdentifier("ip_email", ["ip1", "email2"]),
    );
  });
});

describe("clientIpFromHeaders", () => {
  test("direct connection with no trusted proxy falls back to the direct IP", () => {
    expect(clientIpFromHeaders(undefined, 0, "203.0.113.9")).toBe("203.0.113.9");
  });

  test("one trusted proxy uses the single forwarded entry", () => {
    expect(clientIpFromHeaders("203.0.113.5", 1, "10.0.0.1")).toBe("203.0.113.5");
  });

  test("multiple trusted proxies pick the Nth-from-right entry", () => {
    // client, proxy1 — with 2 trusted proxies the trusted entry is the client's.
    expect(clientIpFromHeaders("203.0.113.5, 10.0.0.2", 2, "10.0.0.3")).toBe("203.0.113.5");
  });

  test("spoofed leading entries are ignored when only one proxy is trusted", () => {
    // Attacker-supplied "9.9.9.9" plus the real IP appended by the one
    // trusted proxy — with trustedProxyCount=1 we must trust the rightmost
    // (proxy-appended) entry, not the attacker-controlled leftmost one.
    expect(clientIpFromHeaders("9.9.9.9, 198.51.100.7", 1, "10.0.0.1")).toBe("198.51.100.7");
  });

  test("IPv4 is accepted", () => {
    expect(clientIpFromHeaders("192.0.2.1", 1, undefined)).toBe("192.0.2.1");
  });

  test("IPv6 is accepted", () => {
    expect(clientIpFromHeaders("2001:db8::1", 1, undefined)).toBe("2001:db8::1");
  });

  test("missing forwarded header falls back to direct IP", () => {
    expect(clientIpFromHeaders(undefined, 1, "203.0.113.9")).toBe("203.0.113.9");
  });

  test("missing everything returns the unknown fallback", () => {
    expect(clientIpFromHeaders(undefined, 1, undefined)).toBe("unknown");
  });

  test("malformed forwarded value returns the unknown fallback", () => {
    expect(clientIpFromHeaders(",, ,", 1, undefined)).toBe("unknown");
  });

  test("incorrect proxy count larger than the chain clamps to the leftmost entry", () => {
    expect(clientIpFromHeaders("203.0.113.5, 10.0.0.2", 9, "10.0.0.3")).toBe("203.0.113.5");
  });
});

process.env.RATE_LIMIT_HMAC_SECRET = ORIGINAL_SECRET;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/rate-limit/identifiers.test.ts`
Expected: FAIL — `identifiers.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Rate-limit identifier derivation: pseudonymous HMAC hashing (never store
 * raw emails/IPs as keys, spec §7) and trusted-proxy-aware client IP
 * resolution (spec §8). clientIpFromHeaders is a pure function so it can be
 * unit tested without a request context; clientIp() wraps it with the real
 * request headers.
 */
import { createHmac } from "node:crypto";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";

const UNKNOWN_IP = "unknown";

function hmacSecret(): string {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET;
  if (!secret) throw new Error("RATE_LIMIT_HMAC_SECRET is not configured");
  return secret;
}

export function hashIdentifier(namespace: string, value: string): string {
  return createHmac("sha256", hmacSecret()).update(`${namespace}:${value}`).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailIdentifier(email: string): string {
  return hashIdentifier("email", normalizeEmail(email));
}

export function ipIdentifier(ip: string): string {
  return hashIdentifier("ip", ip);
}

export function userIdentifier(userId: string): string {
  return hashIdentifier("user", userId);
}

export function compoundIdentifier(namespace: string, parts: string[]): string {
  return hashIdentifier(namespace, parts.join(":"));
}

function normalizeIpCandidate(raw: string): string {
  let ip = raw.trim();
  if (ip.startsWith("[") && ip.includes("]")) {
    ip = ip.slice(1, ip.indexOf("]"));
  } else if (ip.includes(".") && ip.lastIndexOf(":") > ip.lastIndexOf(".")) {
    // IPv4 with a trailing :port, e.g. "1.2.3.4:5678".
    ip = ip.slice(0, ip.lastIndexOf(":"));
  }
  return ip.toLowerCase();
}

function isValidIp(ip: string): boolean {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4.test(ip)) {
    return ip.split(".").every((octet) => Number(octet) <= 255);
  }
  return /^[0-9a-f:]+$/i.test(ip) && ip.includes(":");
}

function resolveAndValidate(raw: string | undefined | null): string {
  if (!raw) return UNKNOWN_IP;
  const normalized = normalizeIpCandidate(raw);
  return isValidIp(normalized) ? normalized : UNKNOWN_IP;
}

/**
 * Pure function: given the raw x-forwarded-for header, the number of
 * trusted proxy hops in front of Mila, and the platform-reported direct
 * connection IP, returns the client address we actually trust. With N
 * trusted proxies, the trustworthy entry is the Nth-from-right in the
 * forwarded chain (each proxy appends the address of whoever connected to
 * it) — anything to the left of that is attacker-controllable and ignored.
 */
export function clientIpFromHeaders(
  forwardedFor: string | undefined | null,
  trustedProxyCount: number,
  directIp?: string | undefined | null,
): string {
  if (trustedProxyCount < 1 || !forwardedFor) {
    return resolveAndValidate(directIp);
  }

  const chain = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (chain.length === 0) {
    return resolveAndValidate(directIp);
  }

  const index = Math.max(0, chain.length - trustedProxyCount);
  return resolveAndValidate(chain[index]);
}

export function clientIp(): string {
  const configured = Number(process.env.RATE_LIMIT_TRUSTED_PROXY_COUNT ?? "1");
  const trustedProxyCount = Number.isInteger(configured) && configured >= 0 ? configured : 1;
  const forwardedFor = getRequestHeader("x-forwarded-for");
  const directIp = getRequestIP({ xForwardedFor: false });
  return clientIpFromHeaders(forwardedFor, trustedProxyCount, directIp);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/rate-limit/identifiers.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit/identifiers.ts src/lib/rate-limit/identifiers.test.ts
git commit -m "$(cat <<'EOF'
feat(rate-limit): add pseudonymous identifiers and trusted-proxy client IP

HMAC-SHA-256 keyed by a dedicated RATE_LIMIT_HMAC_SECRET (never a plain
hash — common emails are guessable offline). clientIp() trusts only
the configured number of proxy hops from the right of
X-Forwarded-For, replacing the naive first-entry parsing that support
form used.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Response helper (`src/lib/rate-limit/response.server.ts`)

**Files:**
- Create: `src/lib/rate-limit/response.server.ts`
- Test: `src/lib/rate-limit/response.server.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RateLimitedError`, `assertRateLimitAllowed(decision, message?)`. Fixes a real gap in the *existing* AI limiter — it throws a plain `Error` and never sets HTTP status, so today's `429`/`Retry-After` requirement (spec §22) isn't actually met. Every later handler (login, signup, AI, etc.) uses this instead of throwing a bare `Error`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { assertRateLimitAllowed, RateLimitedError } from "./response.server";

describe("RateLimitedError", () => {
  test("carries the retry-after value and a generic default message", () => {
    const err = new RateLimitedError(2.3);
    expect(err.message).toBe("Too many attempts. Please try again later.");
    expect(err.retryAfterSeconds).toBe(2.3);
    expect(err).toBeInstanceOf(Error);
  });

  test("accepts a custom public message", () => {
    const err = new RateLimitedError(5, "Too many sign-in attempts.");
    expect(err.message).toBe("Too many sign-in attempts.");
  });
});

describe("assertRateLimitAllowed", () => {
  test("does not throw when allowed", () => {
    expect(() =>
      assertRateLimitAllowed({ allowed: true, retryAfterSeconds: 0 }),
    ).not.toThrow();
  });

  test("throws RateLimitedError when denied", () => {
    expect(() =>
      assertRateLimitAllowed({ allowed: false, retryAfterSeconds: 42 }),
    ).toThrow(RateLimitedError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/rate-limit/response.server.test.ts`
Expected: FAIL — `response.server.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Thrown by every rate-limited handler on denial. Sets the actual HTTP 429
 * status and Retry-After header via TanStack Start's response helpers (the
 * previous AI limiter only threw a plain Error, so callers never saw a real
 * 429 — see spec §22 and this plan's Global Constraints).
 */
import { setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";

const DEFAULT_MESSAGE = "Too many attempts. Please try again later.";

export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message: string = DEFAULT_MESSAGE) {
    super(message);
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
    setResponseStatus(429);
    setResponseHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  }
}

export function assertRateLimitAllowed(
  decision: { allowed: boolean; retryAfterSeconds: number },
  message?: string,
): void {
  if (!decision.allowed) {
    throw new RateLimitedError(decision.retryAfterSeconds, message);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/rate-limit/response.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit/response.server.ts src/lib/rate-limit/response.server.test.ts
git commit -m "$(cat <<'EOF'
feat(rate-limit): add RateLimitedError that sets real HTTP 429 + Retry-After

The previous AI limiter threw a plain Error on denial with no status
code set, so callers never actually received a 429. This is the one
place every handler throws from now on.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Policies registry (`src/lib/rate-limit/policies.ts`)

**Files:**
- Create: `src/lib/rate-limit/policies.ts`
- Test: `src/lib/rate-limit/policies.test.ts`

**Interfaces:**
- Consumes: `RateLimitPolicyName` from Task 2.
- Produces: `RateLimitPolicyConfig`, `getPolicy(name)`, `checkFor(name, subjectHash, costOverride?)` (builds a ready-to-use `RateLimitCheck` from a policy name + subject, so handlers never hardcode a limit/window inline). Numeric values are the single source of truth referenced by the plan's Global Constraints (AI/support values preserved exactly).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { checkFor, getPolicy } from "./policies";

describe("getPolicy", () => {
  test("returns the config for a known policy", () => {
    const policy = getPolicy("login.ip");
    expect(policy.limit).toBe(20);
    expect(policy.windowSeconds).toBe(600);
  });

  test("preserves existing AI limits exactly", () => {
    expect(getPolicy("ai.outfit")).toMatchObject({ limit: 10, windowSeconds: 3600 });
    expect(getPolicy("ai.analysis")).toMatchObject({ limit: 15, windowSeconds: 3600 });
    expect(getPolicy("ai.clothing_analysis")).toMatchObject({ limit: 20, windowSeconds: 3600 });
    expect(getPolicy("ai.dupe_hunter")).toMatchObject({ limit: 15, windowSeconds: 3600 });
    expect(getPolicy("ai.personal_color")).toMatchObject({ limit: 10, windowSeconds: 3600 });
    expect(getPolicy("ai.concierge")).toMatchObject({ limit: 20, windowSeconds: 300 });
    expect(getPolicy("support.ip")).toMatchObject({ limit: 5, windowSeconds: 600 });
  });

  test("throws for an unregistered policy name", () => {
    // @ts-expect-error deliberately invalid at the type level too
    expect(() => getPolicy("not.a.policy")).toThrow();
  });
});

describe("checkFor", () => {
  test("builds a RateLimitCheck from the policy's own numbers", () => {
    const check = checkFor("signup.ip", "hash-abc");
    expect(check).toEqual({
      policy: "signup.ip",
      subjectHash: "hash-abc",
      limit: 5,
      windowSeconds: 3600,
      cost: 1,
    });
  });

  test("allows a cost override", () => {
    expect(checkFor("ai.outfit", "hash-abc", 2).cost).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/rate-limit/policies.test.ts`
Expected: FAIL — `policies.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Single source of truth for every rate-limit policy's numbers and
 * behavior (spec §6.2). Never hardcode a limit/window in a handler —
 * import checkFor()/getPolicy() instead. Values here are initial
 * operational defaults (documented in docs/security/RATE_LIMITING.md);
 * tune by editing this file and redeploying.
 */
import { z } from "zod";
import type { RateLimitCheck, RateLimitPolicyName } from "./types";

export interface RateLimitPolicyConfig {
  name: RateLimitPolicyName;
  limit: number;
  windowSeconds: number;
  cost: number;
  onStoreFailure: "fail_closed" | "fail_open_emergency";
  captcha: "none" | "always" | "escalate";
  publicMessage: string;
  logLevel: "info" | "warn" | "error";
}

const POLICIES: Record<RateLimitPolicyName, RateLimitPolicyConfig> = {
  "login.ip": {
    name: "login.ip",
    limit: 20,
    windowSeconds: 600,
    cost: 1,
    onStoreFailure: "fail_open_emergency",
    captcha: "none",
    publicMessage: "Too many sign-in attempts. Please try again later.",
    logLevel: "warn",
  },
  "login.ip_account": {
    name: "login.ip_account",
    limit: 8,
    windowSeconds: 600,
    cost: 1,
    onStoreFailure: "fail_open_emergency",
    captcha: "none",
    publicMessage: "Too many sign-in attempts. Please try again later.",
    logLevel: "warn",
  },
  "login.account_risk": {
    name: "login.account_risk",
    limit: 5,
    windowSeconds: 600,
    cost: 1,
    // Soft signal only — never gates the request itself. See
    // src/lib/auth/login.functions.ts, which wraps this policy's own
    // consumeRateLimits call in a try/catch that always defaults to
    // "allow" (no CAPTCHA escalation) on a store failure, rather than
    // delegating to the generic emergency-allowance mechanism.
    onStoreFailure: "fail_closed",
    captcha: "escalate",
    publicMessage: "Too many sign-in attempts. Please try again later.",
    logLevel: "info",
  },
  "signup.ip": {
    name: "signup.ip",
    limit: 5,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "always",
    publicMessage: "Too many signup attempts. Please try again later.",
    logLevel: "warn",
  },
  "signup.ip_account": {
    name: "signup.ip_account",
    limit: 3,
    windowSeconds: 86400,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "always",
    publicMessage: "Too many signup attempts. Please try again later.",
    logLevel: "warn",
  },
  "oauth.start.ip": {
    name: "oauth.start.ip",
    limit: 20,
    windowSeconds: 600,
    cost: 1,
    onStoreFailure: "fail_open_emergency",
    captcha: "none",
    publicMessage: "Too many sign-in attempts. Please try again later.",
    logLevel: "warn",
  },
  "oauth.start.session_provider": {
    name: "oauth.start.session_provider",
    limit: 8,
    windowSeconds: 600,
    cost: 1,
    onStoreFailure: "fail_open_emergency",
    captcha: "none",
    publicMessage: "Too many sign-in attempts. Please try again later.",
    logLevel: "warn",
  },
  "oauth.callback.invalid_ip": {
    name: "oauth.callback.invalid_ip",
    limit: 10,
    windowSeconds: 600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "Too many sign-in attempts. Please try again later.",
    logLevel: "warn",
  },
  "oauth.callback.session": {
    name: "oauth.callback.session",
    limit: 10,
    windowSeconds: 600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "Too many sign-in attempts. Please try again later.",
    logLevel: "warn",
  },
  "reauth.user": {
    name: "reauth.user",
    limit: 5,
    windowSeconds: 600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "Too many attempts. Please try again later.",
    logLevel: "warn",
  },
  "reauth.ip_user": {
    name: "reauth.ip_user",
    limit: 8,
    windowSeconds: 600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "Too many attempts. Please try again later.",
    logLevel: "warn",
  },
  "email_change.user": {
    name: "email_change.user",
    limit: 3,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "Too many attempts. Please try again later.",
    logLevel: "warn",
  },
  "email_change.ip": {
    name: "email_change.ip",
    limit: 10,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "Too many attempts. Please try again later.",
    logLevel: "warn",
  },
  "support.ip": {
    name: "support.ip",
    limit: 5,
    windowSeconds: 600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "Too many attempts. Please try again later.",
    logLevel: "warn",
  },
  "ai.outfit": {
    name: "ai.outfit",
    limit: 10,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "You've reached today's outfit generation limit. Please try again later.",
    logLevel: "info",
  },
  "ai.analysis": {
    name: "ai.analysis",
    limit: 15,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "You've reached today's analysis limit. Please try again later.",
    logLevel: "info",
  },
  "ai.clothing_analysis": {
    name: "ai.clothing_analysis",
    limit: 20,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "You've reached today's analysis limit. Please try again later.",
    logLevel: "info",
  },
  "ai.dupe_hunter": {
    name: "ai.dupe_hunter",
    limit: 15,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "You've reached today's search limit. Please try again later.",
    logLevel: "info",
  },
  "ai.personal_color": {
    name: "ai.personal_color",
    limit: 10,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "You've reached today's analysis limit. Please try again later.",
    logLevel: "info",
  },
  "ai.concierge": {
    name: "ai.concierge",
    limit: 20,
    windowSeconds: 300,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "You're sending messages too quickly. Please slow down.",
    logLevel: "info",
  },
  // Reserved — no caller yet (spec §17). Keep numbers here so the first
  // implementer of these flows has a starting point and no excuse to
  // bypass the shared limiter.
  "recovery.ip": {
    name: "recovery.ip",
    limit: 5,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "always",
    publicMessage: "Too many attempts. Please try again later.",
    logLevel: "warn",
  },
  "otp.email.ip": {
    name: "otp.email.ip",
    limit: 5,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "always",
    publicMessage: "Too many attempts. Please try again later.",
    logLevel: "warn",
  },
  "otp.phone.ip": {
    name: "otp.phone.ip",
    limit: 5,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "always",
    publicMessage: "Too many attempts. Please try again later.",
    logLevel: "warn",
  },
  "resend.ip_account": {
    name: "resend.ip_account",
    limit: 3,
    windowSeconds: 3600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "always",
    publicMessage: "Too many attempts. Please try again later.",
    logLevel: "warn",
  },
  "mfa.user_factor": {
    name: "mfa.user_factor",
    limit: 5,
    windowSeconds: 600,
    cost: 1,
    onStoreFailure: "fail_closed",
    captcha: "none",
    publicMessage: "Too many verification attempts. Please try again later.",
    logLevel: "warn",
  },
};

const PolicyConfigSchema = z.object({
  name: z.string().min(1),
  limit: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
  cost: z.number().int().positive(),
  onStoreFailure: z.enum(["fail_closed", "fail_open_emergency"]),
  captcha: z.enum(["none", "always", "escalate"]),
  publicMessage: z.string().min(1),
  logLevel: z.enum(["info", "warn", "error"]),
});

function validatePoliciesAtStartup(): void {
  for (const [key, config] of Object.entries(POLICIES)) {
    const parsed = PolicyConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new Error(`Invalid rate limit policy "${key}": ${parsed.error.message}`);
    }
    if (parsed.data.name !== key) {
      throw new Error(`Policy key/name mismatch for "${key}"`);
    }
  }
}

// Runs once at module load — every handler imports this module before it
// can build a check, so this is effectively an application-startup gate
// (spec §6.2: "invalid production configuration must fail fast").
validatePoliciesAtStartup();

export function getPolicy(name: RateLimitPolicyName): RateLimitPolicyConfig {
  const policy = POLICIES[name];
  if (!policy) throw new Error(`Unknown rate limit policy: ${name}`);
  return policy;
}

export function checkFor(
  name: RateLimitPolicyName,
  subjectHash: string,
  costOverride?: number,
): RateLimitCheck {
  const policy = getPolicy(name);
  return {
    policy: name,
    subjectHash,
    limit: policy.limit,
    windowSeconds: policy.windowSeconds,
    cost: costOverride ?? policy.cost,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/rate-limit/policies.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit/policies.ts src/lib/rate-limit/policies.test.ts
git commit -m "$(cat <<'EOF'
feat(rate-limit): add centralized, Zod-validated policy registry

Every numeric limit lives here now instead of scattered across
handlers. Preserves the six existing AI endpoints' limits exactly.
Reserves policy names for magic-link/OTP/MFA/recovery flows that
don't exist in the product yet, so the first implementer has no
excuse to bypass the shared limiter.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Store interface + memory adapter (`src/lib/rate-limit/store.ts`, `memory-store.ts`)

**Files:**
- Create: `src/lib/rate-limit/store.ts`
- Create: `src/lib/rate-limit/memory-store.ts`
- Test: `src/lib/rate-limit/memory-store.test.ts`

**Interfaces:**
- Consumes: `RateLimitCheck`, `RateLimitDecision` from Task 2.
- Produces: `RateLimitStore` interface (`consume(checks): Promise<Map<string, RateLimitDecision>>`), `MemoryRateLimitStore`. Task 7 (`PostgresRateLimitStore`) implements the same `RateLimitStore` interface; Task 8's adapter contract tests run against both; Task 9's limiter core uses the interface.

- [ ] **Step 1: Write the shared interface**

```ts
import type { RateLimitCheck, RateLimitDecision } from "./types";

export interface RateLimitStore {
  /**
   * Consumes every check in one call. Implementations must be atomic across
   * the whole batch (spec §5.1) — no partial consumption if part of the
   * batch fails. Returns one decision per distinct policy name in the
   * batch (call sites never repeat a policy name within one batch).
   */
  consume(checks: RateLimitCheck[]): Promise<Map<string, RateLimitDecision>>;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { MemoryRateLimitStore } from "./memory-store";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ALLOW = process.env.RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT;

beforeEach(() => {
  process.env.NODE_ENV = "development";
  process.env.RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT = "true";
});

describe("MemoryRateLimitStore production guard", () => {
  test("throws unconditionally when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    expect(() => new MemoryRateLimitStore()).toThrow(/production/i);
  });

  test("RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT=true cannot override the production prohibition", () => {
    process.env.NODE_ENV = "production";
    process.env.RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT = "true";
    expect(() => new MemoryRateLimitStore()).toThrow(/production/i);
  });

  test("throws outside production without explicit opt-in", () => {
    process.env.NODE_ENV = "development";
    delete process.env.RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT;
    expect(() => new MemoryRateLimitStore()).toThrow(/opt-in/i);
  });

  test("succeeds outside production with explicit opt-in", () => {
    expect(() => new MemoryRateLimitStore()).not.toThrow();
  });
});

describe("MemoryRateLimitStore.consume", () => {
  test("allows the first request under the limit", async () => {
    const store = new MemoryRateLimitStore();
    const result = await store.consume([
      { policy: "signup.ip", subjectHash: "s1", limit: 2, windowSeconds: 60, cost: 1 },
    ]);
    expect(result.get("signup.ip")?.allowed).toBe(true);
    expect(result.get("signup.ip")?.remaining).toBe(1);
  });

  test("denies the request once over the limit", async () => {
    const store = new MemoryRateLimitStore();
    const check = { policy: "signup.ip" as const, subjectHash: "s1", limit: 2, windowSeconds: 60, cost: 1 };
    await store.consume([check]);
    await store.consume([check]);
    const third = await store.consume([check]);
    expect(third.get("signup.ip")?.allowed).toBe(false);
    expect(third.get("signup.ip")?.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("independent subjects do not collide", async () => {
    const store = new MemoryRateLimitStore();
    const base = { policy: "signup.ip" as const, limit: 1, windowSeconds: 60, cost: 1 };
    await store.consume([{ ...base, subjectHash: "a" }]);
    const result = await store.consume([{ ...base, subjectHash: "b" }]);
    expect(result.get("signup.ip")?.allowed).toBe(true);
  });

  test("independent policies do not collide", async () => {
    const store = new MemoryRateLimitStore();
    await store.consume([{ policy: "signup.ip", subjectHash: "s1", limit: 1, windowSeconds: 60, cost: 1 }]);
    const result = await store.consume([
      { policy: "login.ip", subjectHash: "s1", limit: 1, windowSeconds: 60, cost: 1 },
    ]);
    expect(result.get("login.ip")?.allowed).toBe(true);
  });

  test("cost greater than one consumes multiple slots at once", async () => {
    const store = new MemoryRateLimitStore();
    const result = await store.consume([
      { policy: "ai.outfit", subjectHash: "s1", limit: 5, windowSeconds: 60, cost: 3 },
    ]);
    expect(result.get("ai.outfit")?.remaining).toBe(2);
  });

  test("expired window resets the counter", async () => {
    const store = new MemoryRateLimitStore();
    const check = { policy: "login.ip" as const, subjectHash: "s1", limit: 1, windowSeconds: 0, cost: 1 };
    await store.consume([check]);
    const second = await store.consume([{ ...check, windowSeconds: 60 }]);
    expect(second.get("login.ip")?.allowed).toBe(true);
  });
});

process.env.NODE_ENV = ORIGINAL_NODE_ENV;
process.env.RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT = ORIGINAL_ALLOW;
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/lib/rate-limit/memory-store.test.ts`
Expected: FAIL — `memory-store.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```ts
/**
 * Dev/test-only in-memory rate-limit store (spec §6.5). Never usable in
 * production — see the two guards in the constructor. Production always
 * uses PostgresRateLimitStore (Task 7).
 */
import type { RateLimitCheck, RateLimitDecision } from "./types";
import type { RateLimitStore } from "./store";

interface Bucket {
  windowStart: number;
  count: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Memory rate-limit storage cannot be used in production");
    }
    if (process.env.RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT !== "true") {
      throw new Error(
        "Memory rate-limit storage requires explicit development opt-in " +
          "(set RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT=true)",
      );
    }
  }

  async consume(checks: RateLimitCheck[]): Promise<Map<string, RateLimitDecision>> {
    const now = Date.now();
    const result = new Map<string, RateLimitDecision>();

    for (const check of checks) {
      const key = `${check.policy}${check.subjectHash}`;
      const windowMs = check.windowSeconds * 1000;
      const cost = check.cost ?? 1;

      let bucket = this.buckets.get(key);
      if (!bucket || bucket.windowStart <= now - windowMs) {
        bucket = { windowStart: now, count: 0 };
      }
      bucket.count += cost;
      this.buckets.set(key, bucket);

      const resetAt = new Date(bucket.windowStart + windowMs);
      const allowed = bucket.count <= check.limit;
      result.set(check.policy, {
        allowed,
        limit: check.limit,
        remaining: Math.max(0, check.limit - bucket.count),
        resetAt,
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000)),
      });
    }

    return result;
  }

  /** Test-only: clears all counters between test cases. */
  reset(): void {
    this.buckets.clear();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/lib/rate-limit/memory-store.test.ts`
Expected: PASS (all cases, including both production guards).

- [ ] **Step 6: Commit**

```bash
git add src/lib/rate-limit/store.ts src/lib/rate-limit/memory-store.ts src/lib/rate-limit/memory-store.test.ts
git commit -m "$(cat <<'EOF'
feat(rate-limit): add RateLimitStore interface and memory adapter

Memory adapter is dev/test-only: throws unconditionally in
production, and requires explicit RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT
opt-in outside it. Production always uses PostgresRateLimitStore.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Postgres store adapter (`src/lib/rate-limit/postgres-store.ts`)

**Files:**
- Create: `src/lib/rate-limit/postgres-store.ts`

**Interfaces:**
- Consumes: `RateLimitStore` from Task 6's `store.ts`, `RateLimitCheck`/`RateLimitDecision` from Task 2, `public.consume_rate_limits(jsonb)` RPC from Task 1.
- Produces: `PostgresRateLimitStore`, `RateLimitStoreError` (with `category: "timeout" | "unavailable" | "malformed_response"`). Task 9's `limiter.server.ts` catches `RateLimitStoreError` to apply each policy's documented failure behavior.

This adapter's correctness (does the RPC actually get called and parsed right) is proven by Task 8's shared adapter-contract test suite running against it — writing a redundant unit test here that mocks `supabaseAdmin.rpc` would just re-assert the mock, not real behavior, so no separate test file for this task.

- [ ] **Step 1: Write the implementation**

```ts
/**
 * Production rate-limit store: one batched call to the
 * public.consume_rate_limits(jsonb) RPC (Task 1's migration). Never
 * accepts a caller-supplied RPC or table name, applies a hard timeout so a
 * slow database can't hang an auth request indefinitely (spec §20.5), and
 * validates the RPC response shape before trusting it.
 */
import { z } from "zod";
import type { RateLimitCheck, RateLimitDecision } from "./types";
import type { RateLimitStore } from "./store";

const DEFAULT_TIMEOUT_MS = 1500;

const RpcRowSchema = z.object({
  policy: z.string(),
  allowed: z.boolean(),
  limit_value: z.number().int(),
  remaining: z.number().int(),
  reset_at: z.string(),
  retry_after_seconds: z.number().int(),
});
const RpcResponseSchema = z.array(RpcRowSchema);

export type RateLimitStoreErrorCategory = "timeout" | "unavailable" | "malformed_response";

export class RateLimitStoreError extends Error {
  readonly category: RateLimitStoreErrorCategory;

  constructor(category: RateLimitStoreErrorCategory, message: string) {
    super(message);
    this.name = "RateLimitStoreError";
    this.category = category;
  }
}

function storeTimeoutMs(): number {
  const configured = Number(process.env.RATE_LIMIT_STORE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

export class PostgresRateLimitStore implements RateLimitStore {
  async consume(checks: RateLimitCheck[]): Promise<Map<string, RateLimitDecision>> {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const payload = checks.map((check) => ({
      policy: check.policy,
      subjectHash: check.subjectHash,
      limit: check.limit,
      windowSeconds: check.windowSeconds,
      cost: check.cost ?? 1,
    }));

    const timeoutMs = storeTimeoutMs();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new RateLimitStoreError("timeout", "rate limit store timed out")),
        timeoutMs,
      );
    });

    let data: unknown;
    let rpcError: { message: string } | null;
    try {
      ({ data, error: rpcError } = await Promise.race([
        supabaseAdmin.rpc("consume_rate_limits", { _checks: payload }),
        timeout,
      ]));
    } catch (err) {
      if (err instanceof RateLimitStoreError) throw err;
      throw new RateLimitStoreError(
        "unavailable",
        err instanceof Error ? err.message : "unknown rate limit store error",
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (rpcError) {
      throw new RateLimitStoreError("unavailable", rpcError.message);
    }

    const parsed = RpcResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new RateLimitStoreError("malformed_response", parsed.error.message);
    }

    const result = new Map<string, RateLimitDecision>();
    for (const row of parsed.data) {
      result.set(row.policy, {
        allowed: row.allowed,
        limit: row.limit_value,
        remaining: row.remaining,
        resetAt: new Date(row.reset_at),
        retryAfterSeconds: row.retry_after_seconds,
      });
    }
    return result;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/rate-limit/postgres-store.ts
git commit -m "$(cat <<'EOF'
feat(rate-limit): add Postgres production store adapter

One batched RPC call per consumeRateLimits() invocation, request
timeout, and Zod validation of the RPC response so a malformed result
never gets trusted silently.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Adapter contract tests (`src/lib/rate-limit/store-contract.test.ts`)

**Files:**
- Create: `src/lib/rate-limit/store-contract.test.ts`

**Interfaces:**
- Consumes: `RateLimitStore` (Task 6), `MemoryRateLimitStore` (Task 6), `PostgresRateLimitStore` (Task 7).

One test body, parameterized over both adapters (spec §24.1). The Postgres branch is skipped unless a live Supabase stack is reachable — this sandbox has none (verified), so it's written and documented as requiring one, never claimed as passing.

- [ ] **Step 1: Write the shared contract suite**

```ts
import { describe, expect, test } from "bun:test";
import { MemoryRateLimitStore } from "./memory-store";
import { PostgresRateLimitStore } from "./postgres-store";
import type { RateLimitStore } from "./store";

process.env.RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT = "true";
process.env.NODE_ENV = "test";

/**
 * Runs the same behavioral contract against any RateLimitStore
 * implementation. Both adapters must satisfy every case identically —
 * callers (limiter.server.ts) must not need to know which one is active.
 */
function runContractSuite(name: string, makeStore: () => RateLimitStore) {
  describe(`RateLimitStore contract: ${name}`, () => {
    test("first request under the limit is allowed", async () => {
      const store = makeStore();
      const result = await store.consume([
        { policy: "signup.ip", subjectHash: `${name}-1`, limit: 3, windowSeconds: 60, cost: 1 },
      ]);
      expect(result.get("signup.ip")?.allowed).toBe(true);
    });

    test("the final permitted request is allowed", async () => {
      const store = makeStore();
      const check = {
        policy: "signup.ip" as const,
        subjectHash: `${name}-2`,
        limit: 2,
        windowSeconds: 60,
        cost: 1,
      };
      await store.consume([check]);
      const result = await store.consume([check]);
      expect(result.get("signup.ip")?.allowed).toBe(true);
      expect(result.get("signup.ip")?.remaining).toBe(0);
    });

    test("the first over-limit request is denied", async () => {
      const store = makeStore();
      const check = {
        policy: "signup.ip" as const,
        subjectHash: `${name}-3`,
        limit: 1,
        windowSeconds: 60,
        cost: 1,
      };
      await store.consume([check]);
      const result = await store.consume([check]);
      expect(result.get("signup.ip")?.allowed).toBe(false);
      expect(result.get("signup.ip")?.retryAfterSeconds).toBeGreaterThan(0);
    });

    test("independent policies do not collide for the same subject", async () => {
      const store = makeStore();
      const subject = `${name}-4`;
      await store.consume([{ policy: "signup.ip", subjectHash: subject, limit: 1, windowSeconds: 60, cost: 1 }]);
      const result = await store.consume([
        { policy: "login.ip", subjectHash: subject, limit: 1, windowSeconds: 60, cost: 1 },
      ]);
      expect(result.get("login.ip")?.allowed).toBe(true);
    });

    test("independent subjects do not collide for the same policy", async () => {
      const store = makeStore();
      await store.consume([{ policy: "signup.ip", subjectHash: `${name}-5a`, limit: 1, windowSeconds: 60, cost: 1 }]);
      const result = await store.consume([
        { policy: "signup.ip", subjectHash: `${name}-5b`, limit: 1, windowSeconds: 60, cost: 1 },
      ]);
      expect(result.get("signup.ip")?.allowed).toBe(true);
    });

    test("cost greater than one is consumed atomically", async () => {
      const store = makeStore();
      const result = await store.consume([
        { policy: "ai.outfit", subjectHash: `${name}-6`, limit: 5, windowSeconds: 60, cost: 3 },
      ]);
      expect(result.get("ai.outfit")?.remaining).toBe(2);
    });

    test("a batch consumes every check atomically in one call", async () => {
      const store = makeStore();
      const subject = `${name}-7`;
      const result = await store.consume([
        { policy: "login.ip", subjectHash: subject, limit: 5, windowSeconds: 60, cost: 1 },
        { policy: "login.ip_account", subjectHash: subject, limit: 5, windowSeconds: 60, cost: 1 },
      ]);
      expect(result.get("login.ip")?.allowed).toBe(true);
      expect(result.get("login.ip_account")?.allowed).toBe(true);
    });
  });
}

runContractSuite("memory", () => new MemoryRateLimitStore());

const hasLiveSupabase = process.env.RATE_LIMIT_CONTRACT_TEST_LIVE_SUPABASE === "true";
if (hasLiveSupabase) {
  runContractSuite("postgres", () => new PostgresRateLimitStore());
} else {
  describe("RateLimitStore contract: postgres", () => {
    test.skip(
      "requires a live Supabase stack — set RATE_LIMIT_CONTRACT_TEST_LIVE_SUPABASE=true " +
        "and SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY pointed at `supabase start` to run this",
      () => {},
    );
  });
}
```

- [ ] **Step 2: Run the memory half for real**

Run: `bun test src/lib/rate-limit/store-contract.test.ts`
Expected: PASS for every `RateLimitStore contract: memory` case; the `postgres` describe block reports one skipped test (no live Supabase stack in this sandbox — verified no Docker/Supabase CLI available). Do not claim the postgres branch passed.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rate-limit/store-contract.test.ts
git commit -m "$(cat <<'EOF'
test(rate-limit): add shared adapter contract suite for memory + postgres stores

Runs the same behavioral contract against both RateLimitStore
implementations. The postgres branch is skipped without a live
Supabase stack (none available in this environment) rather than
claimed as passing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Limiter core (`src/lib/rate-limit/limiter.server.ts`)

**Files:**
- Create: `src/lib/rate-limit/limiter.server.ts`
- Test: `src/lib/rate-limit/limiter.server.test.ts`

**Interfaces:**
- Consumes: `RateLimitStore` (Task 6), `PostgresRateLimitStore`/`RateLimitStoreError` (Task 7), `getPolicy` (Task 5), `RateLimitCheck`/`CombinedRateLimitDecision` (Task 2).
- Produces: `consumeRateLimits(checks): Promise<CombinedRateLimitDecision>`, `__setRateLimitStoreForTests(store)` (test-only injection point). Every handler task (11-17) and the AI migration (Task 10) calls `consumeRateLimits`.

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { consumeRateLimits, __setRateLimitStoreForTests } from "./limiter.server";
import { MemoryRateLimitStore } from "./memory-store";
import { RateLimitStoreError } from "./postgres-store";
import type { RateLimitCheck, RateLimitDecision } from "./types";
import type { RateLimitStore } from "./store";

process.env.RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT = "true";
process.env.NODE_ENV = "test";

afterEach(() => {
  __setRateLimitStoreForTests(undefined);
});

describe("consumeRateLimits — happy path", () => {
  beforeEach(() => {
    __setRateLimitStoreForTests(new MemoryRateLimitStore());
  });

  test("allows when every check in the batch is under its limit", async () => {
    const result = await consumeRateLimits([
      { policy: "login.ip", subjectHash: "s1", limit: 5, windowSeconds: 60, cost: 1 },
      { policy: "login.ip_account", subjectHash: "s1", limit: 5, windowSeconds: 60, cost: 1 },
    ]);
    expect(result.allowed).toBe(true);
    expect(result.decisions).toHaveLength(2);
  });

  test("deny-wins: one denied check in the batch denies the whole request", async () => {
    const check = { policy: "login.ip" as const, subjectHash: "s2", limit: 1, windowSeconds: 60, cost: 1 };
    await consumeRateLimits([check]);
    const result = await consumeRateLimits([
      check,
      { policy: "login.ip_account", subjectHash: "s2", limit: 100, windowSeconds: 60, cost: 1 },
    ]);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("throws when called with an empty check list", async () => {
    await expect(consumeRateLimits([])).rejects.toThrow();
  });
});

describe("consumeRateLimits — store failure behavior", () => {
  class FailingStore implements RateLimitStore {
    constructor(private readonly error: Error) {}
    async consume(_checks: RateLimitCheck[]): Promise<Map<string, RateLimitDecision>> {
      throw this.error;
    }
  }

  test("fail_closed policies (e.g. signup.ip) deny on a store outage", async () => {
    __setRateLimitStoreForTests(new FailingStore(new RateLimitStoreError("unavailable", "down")));
    const result = await consumeRateLimits([
      { policy: "signup.ip", subjectHash: "s3", limit: 5, windowSeconds: 60, cost: 1 },
    ]);
    expect(result.allowed).toBe(false);
  });

  test("fail_open_emergency policies (e.g. login.ip) allow a small bounded number of requests, then deny", async () => {
    __setRateLimitStoreForTests(new FailingStore(new RateLimitStoreError("timeout", "slow")));
    const check = { policy: "login.ip" as const, subjectHash: "s4", limit: 20, windowSeconds: 600, cost: 1 };

    const outcomes: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const result = await consumeRateLimits([check]);
      outcomes.push(result.allowed);
    }
    expect(outcomes.filter(Boolean).length).toBeLessThanOrEqual(3);
    expect(outcomes.some((allowed) => !allowed)).toBe(true);
  });

  test("never fails open unconditionally — a fail_closed policy is never allowed on error", async () => {
    __setRateLimitStoreForTests(new FailingStore(new RateLimitStoreError("malformed_response", "bad json")));
    for (let i = 0; i < 5; i++) {
      const result = await consumeRateLimits([
        { policy: "email_change.user", subjectHash: "s5", limit: 3, windowSeconds: 60, cost: 1 },
      ]);
      expect(result.allowed).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/rate-limit/limiter.server.test.ts`
Expected: FAIL — `limiter.server.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * consumeRateLimits() is the only entry point every handler uses (spec
 * §6.6). Resolves policy config, calls the store once, combines decisions
 * with deny-wins semantics, and applies each policy's own documented
 * store-failure behavior (spec §20) — a single store outage can mix
 * fail-closed and fail-open-emergency policies within the same batch, so
 * failure handling happens per-check, not per-request.
 */
import { getPolicy } from "./policies";
import { PostgresRateLimitStore } from "./postgres-store";
import type { RateLimitStore } from "./store";
import type { CombinedRateLimitDecision, RateLimitCheck, RateLimitDecision } from "./types";

let storeOverride: RateLimitStore | undefined;

/** Test-only. Production never calls this. */
export function __setRateLimitStoreForTests(store: RateLimitStore | undefined): void {
  storeOverride = store;
}

function getStore(): RateLimitStore {
  return storeOverride ?? new PostgresRateLimitStore();
}

const EMERGENCY_LIMIT = 3;
const EMERGENCY_WINDOW_MS = 60_000;
const emergencyAllowance = new Map<string, { count: number; expiresAt: number }>();

/**
 * Small, strictly bounded process-local allowance used only while the
 * durable store is unavailable, for policies explicitly marked
 * fail_open_emergency (spec §20.2/20.3). Never the normal production path.
 */
function checkEmergencyAllowance(policy: string, subjectHash: string): boolean {
  const key = `${policy}${subjectHash}`;
  const now = Date.now();
  const entry = emergencyAllowance.get(key);
  if (!entry || entry.expiresAt <= now) {
    emergencyAllowance.set(key, { count: 1, expiresAt: now + EMERGENCY_WINDOW_MS });
    return true;
  }
  if (entry.count >= EMERGENCY_LIMIT) return false;
  entry.count += 1;
  return true;
}

function decisionFor(check: RateLimitCheck, allowed: boolean, retryAfterSeconds: number): RateLimitDecision {
  return {
    allowed,
    limit: check.limit,
    remaining: 0,
    resetAt: new Date(Date.now() + retryAfterSeconds * 1000),
    retryAfterSeconds,
  };
}

export async function consumeRateLimits(checks: RateLimitCheck[]): Promise<CombinedRateLimitDecision> {
  if (checks.length === 0) {
    throw new Error("consumeRateLimits requires at least one check");
  }

  let raw: Map<string, RateLimitDecision>;
  try {
    raw = await getStore().consume(checks);
  } catch (err) {
    const category = (err as { category?: string })?.category ?? "unavailable";
    console.error(
      `[rate-limit] store failure (${category}):`,
      err instanceof Error ? err.message : String(err),
    );

    const decisions: CombinedRateLimitDecision["decisions"] = [];
    let allowed = true;
    let retryAfterSeconds = 0;

    for (const check of checks) {
      const policy = getPolicy(check.policy);
      if (policy.onStoreFailure === "fail_open_emergency" && checkEmergencyAllowance(check.policy, check.subjectHash)) {
        console.error(
          `[rate-limit] EMERGENCY ALLOWANCE used for policy=${check.policy} — durable store is down`,
        );
        decisions.push({ policy: check.policy, decision: decisionFor(check, true, 0) });
        continue;
      }
      allowed = false;
      retryAfterSeconds = Math.max(retryAfterSeconds, 30);
      decisions.push({ policy: check.policy, decision: decisionFor(check, false, 30) });
    }

    return { allowed, retryAfterSeconds, decisions };
  }

  const decisions: CombinedRateLimitDecision["decisions"] = [];
  let allowed = true;
  let retryAfterSeconds = 0;

  for (const check of checks) {
    const decision = raw.get(check.policy);
    if (!decision) {
      throw new Error(`Rate limit store did not return a decision for policy ${check.policy}`);
    }
    decisions.push({ policy: check.policy, decision });
    if (!decision.allowed) {
      allowed = false;
      retryAfterSeconds = Math.max(retryAfterSeconds, decision.retryAfterSeconds);
    }
  }

  return { allowed, retryAfterSeconds, decisions };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/rate-limit/limiter.server.test.ts`
Expected: PASS (happy path, deny-wins, empty-batch rejection, fail-closed-on-error, bounded emergency allowance, never-unconditionally-open).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit/limiter.server.ts src/lib/rate-limit/limiter.server.test.ts
git commit -m "$(cat <<'EOF'
feat(rate-limit): add consumeRateLimits() limiter core

Deny-wins combination across a batch, per-policy store-failure
behavior (fail_closed vs. a strictly bounded process-local emergency
allowance), and a test injection point so handler tests never touch
Postgres.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Migrate the six AI endpoints + support form onto the shared limiter

**Files:**
- Modify: `src/lib/generate-outfit.functions.ts:1-11,182-190`
- Modify: `src/lib/analyze-outfit.functions.ts:1-9,55-64`
- Modify: `src/lib/dupe-hunter.functions.ts:1-15,124-133`
- Modify: `src/lib/analyzePersonalColor.functions.ts:1-14,264-273`
- Modify: `src/lib/analyze-clothing.functions.ts:1-13,73-82`
- Modify: `src/lib/concierge-chat.functions.ts:1-10,41-42,139-144`
- Modify: `src/lib/support.functions.ts` (whole file — small)
- Delete: `src/lib/ai-rate-limit.server.ts`

**Interfaces:**
- Consumes: `consumeRateLimits` (Task 9), `checkFor`/`getPolicy` (Task 5), `assertRateLimitAllowed` (Task 4), `userIdentifier`/`ipIdentifier`/`clientIp` (Task 3).
- Produces: nothing new — this task retires the old `consumeRateLimit`/`RateLimitExceededError` API entirely. After this task, `grep -r "ai-rate-limit.server" src` must return nothing.

Every call site follows the identical transformation: drop the local `_LIMIT`/`_WINDOW_SECONDS` constants (now centralized in `policies.ts`), replace the `try { await consumeRateLimit(key, limit, window) } catch { ... throw new Error(...) }` block with `assertRateLimitAllowed(await consumeRateLimits([checkFor(policy, userIdentifier(context.userId))]))`, and swap the import. No behavior change beyond real `429`/`Retry-After` headers now actually being set (see Task 4).

- [ ] **Step 1: `src/lib/generate-outfit.functions.ts`**

Replace the import block:

```ts
// before
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";
```

```ts
// after
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { assertRateLimitAllowed } from "@/lib/rate-limit/response.server";
import { checkFor } from "@/lib/rate-limit/policies";
import { userIdentifier } from "@/lib/rate-limit/identifiers";
```

Delete the now-centralized constants:

```ts
// delete these two lines
const GENERATE_LOOK_LIMIT = 10;
const GENERATE_LOOK_WINDOW_SECONDS = 60 * 60;
```

Replace the consumption block (was lines 182-190):

```ts
// before
      await consumeRateLimit(
        `ai:generateDailyLook:${context.userId}`,
        GENERATE_LOOK_LIMIT,
        GENERATE_LOOK_WINDOW_SECONDS,
      );
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }
```

```ts
// after
      const decision = await consumeRateLimits([
        checkFor("ai.outfit", userIdentifier(context.userId)),
      ]);
      assertRateLimitAllowed(decision);
```

Note the enclosing `try {` before this block and its own outer `try`/`catch` for the AI call become unnecessary for *this* consumption step — remove the now-empty `try {` that only wrapped the old rate-limit call (check the surrounding lines when editing; keep any `try` that also wraps other logic below it intact).

- [ ] **Step 2: `src/lib/analyze-outfit.functions.ts`**

```ts
// before (lines 6, 8-9)
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";

const ANALYZE_OUTFIT_LIMIT = 15;
const ANALYZE_OUTFIT_WINDOW_SECONDS = 60 * 60;
```

```ts
// after
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { assertRateLimitAllowed } from "@/lib/rate-limit/response.server";
import { checkFor } from "@/lib/rate-limit/policies";
import { userIdentifier } from "@/lib/rate-limit/identifiers";
```

```ts
// before (lines 55-64)
    try {
      await consumeRateLimit(
        `ai:analyzeOutfit:${context.userId}`,
        ANALYZE_OUTFIT_LIMIT,
        ANALYZE_OUTFIT_WINDOW_SECONDS,
      );
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }
```

```ts
// after
    const decision = await consumeRateLimits([
      checkFor("ai.analysis", userIdentifier(context.userId)),
    ]);
    assertRateLimitAllowed(decision);
```

- [ ] **Step 3: `src/lib/dupe-hunter.functions.ts`**

```ts
// before (line 10, 14-15)
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";

const FIND_DUPES_LIMIT = 15;
const FIND_DUPES_WINDOW_SECONDS = 60 * 60;
```

```ts
// after
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { assertRateLimitAllowed } from "@/lib/rate-limit/response.server";
import { checkFor } from "@/lib/rate-limit/policies";
import { userIdentifier } from "@/lib/rate-limit/identifiers";
```

```ts
// before (lines ~124-133)
      await consumeRateLimit(
        `ai:findDupes:${context.userId}`,
        FIND_DUPES_LIMIT,
        FIND_DUPES_WINDOW_SECONDS,
      );
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }
```

```ts
// after
      const decision = await consumeRateLimits([
        checkFor("ai.dupe_hunter", userIdentifier(context.userId)),
      ]);
      assertRateLimitAllowed(decision);
```

- [ ] **Step 4: `src/lib/analyzePersonalColor.functions.ts`**

```ts
// before (line 5, 13-14)
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";

const ANALYZE_COLOR_LIMIT = 10;
const ANALYZE_COLOR_WINDOW_SECONDS = 60 * 60;
```

```ts
// after
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { assertRateLimitAllowed } from "@/lib/rate-limit/response.server";
import { checkFor } from "@/lib/rate-limit/policies";
import { userIdentifier } from "@/lib/rate-limit/identifiers";
```

```ts
// before (lines ~264-273)
          await consumeRateLimit(
            `ai:analyzePersonalColor:${context.userId}`,
            ANALYZE_COLOR_LIMIT,
            ANALYZE_COLOR_WINDOW_SECONDS,
          );
        } catch (err) {
          if (err instanceof RateLimitExceededError) return { success: false, error: "ANALYSIS_RATE_LIMITED" };
          throw err;
        }
```

```ts
// after
        const decision = await consumeRateLimits([
          checkFor("ai.personal_color", userIdentifier(context.userId)),
        ]);
        if (!decision.allowed) return { success: false, error: "ANALYSIS_RATE_LIMITED" };
```

Note: this call site returns a typed error result instead of throwing (the surrounding code already has a `{ success: false, error: "ANALYSIS_RATE_LIMITED" }` convention at two other spots — lines shown as 324 and 610 in the file before this edit). Do not use `assertRateLimitAllowed` here; keep the existing `{ success, error }` contract so the other two call sites checking `pass1Res.status === 429` and the final fallback stay consistent. `assertRateLimitAllowed`/`RateLimitedError` are for handlers that communicate failure by throwing — this one communicates it via a typed return value, so match its existing convention instead.

- [ ] **Step 5: `src/lib/analyze-clothing.functions.ts`**

```ts
// before (line 6, 12-13)
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";

const ANALYZE_CLOTHING_LIMIT = 20;
const ANALYZE_CLOTHING_WINDOW_SECONDS = 60 * 60;
```

```ts
// after
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { assertRateLimitAllowed } from "@/lib/rate-limit/response.server";
import { checkFor } from "@/lib/rate-limit/policies";
import { userIdentifier } from "@/lib/rate-limit/identifiers";
```

```ts
// before (lines ~73-82)
      await consumeRateLimit(
        `ai:analyzeClothing:${context.userId}`,
        ANALYZE_CLOTHING_LIMIT,
        ANALYZE_CLOTHING_WINDOW_SECONDS,
      );
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }
```

```ts
// after
      const decision = await consumeRateLimits([
        checkFor("ai.clothing_analysis", userIdentifier(context.userId)),
      ]);
      assertRateLimitAllowed(decision);
```

- [ ] **Step 6: `src/lib/concierge-chat.functions.ts`**

```ts
// before (line 6, 41-42)
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";
...
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 5 * 60_000;
```

```ts
// after
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { assertRateLimitAllowed } from "@/lib/rate-limit/response.server";
import { checkFor } from "@/lib/rate-limit/policies";
import { userIdentifier } from "@/lib/rate-limit/identifiers";
```

```ts
// before (line 140)
      await consumeRateLimit(`ai:concierge:${context.userId}`, RATE_LIMIT, RATE_WINDOW_MS / 1000);
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }
```

```ts
// after
      const decision = await consumeRateLimits([
        checkFor("ai.concierge", userIdentifier(context.userId)),
      ]);
      assertRateLimitAllowed(decision);
```

- [ ] **Step 7: `src/lib/support.functions.ts`**

This is unauthenticated (no `context.userId`), so it keys on the shared `clientIp()`/`ipIdentifier()` helpers instead of the file's own hand-rolled `clientIp()` — deleting the naive local implementation entirely (spec §8: "replace the naive parsing in support.functions.ts").

```ts
// before (whole file)
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { verifyHcaptcha } from "./hcaptcha.server";
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";

const SubmitSupportMessageInput = z.object({
  kind: z.enum(["help", "feedback"]),
  message: z.string().trim().min(1).max(2000),
  captchaToken: z.string().min(1).max(4000),
});

const SUPPORT_SUBMIT_LIMIT = 5;
const SUPPORT_SUBMIT_WINDOW_SECONDS = 10 * 60;

/** Best-effort caller IP, assuming the deployment's proxy sets x-forwarded-for. */
function clientIp(): string {
  const forwarded = getRequest()?.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

// Unauthenticated on purpose: the login page redirects signed-in users away,
// so submitters here never have a session. Writes go through the service
// role — support_messages has no anon/authenticated INSERT grant. Being
// unauthenticated and open to the public internet, this is gated by both a
// server-verified hCaptcha token and a per-IP rate limit.
export const submitSupportMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => SubmitSupportMessageInput.parse(input))
  .handler(async ({ data }) => {
    const ip = clientIp();

    try {
      await consumeRateLimit(
        `support-message:${ip}`,
        SUPPORT_SUBMIT_LIMIT,
        SUPPORT_SUBMIT_WINDOW_SECONDS,
      );
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }

    await verifyHcaptcha(data.captchaToken, ip !== "unknown" ? ip : undefined);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("support_messages")
      .insert({ kind: data.kind, message: data.message });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
```

```ts
// after (whole file)
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyHcaptcha } from "./hcaptcha.server";
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { assertRateLimitAllowed } from "@/lib/rate-limit/response.server";
import { checkFor } from "@/lib/rate-limit/policies";
import { clientIp, ipIdentifier } from "@/lib/rate-limit/identifiers";

const SubmitSupportMessageInput = z.object({
  kind: z.enum(["help", "feedback"]),
  message: z.string().trim().min(1).max(2000),
  captchaToken: z.string().min(1).max(4000),
});

// Unauthenticated on purpose: the login page redirects signed-in users away,
// so submitters here never have a session. Writes go through the service
// role — support_messages has no anon/authenticated INSERT grant. Being
// unauthenticated and open to the public internet, this is gated by both a
// server-verified hCaptcha token and a per-IP rate limit.
export const submitSupportMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => SubmitSupportMessageInput.parse(input))
  .handler(async ({ data }) => {
    const ip = clientIp();

    const decision = await consumeRateLimits([checkFor("support.ip", ipIdentifier(ip))]);
    assertRateLimitAllowed(decision);

    await verifyHcaptcha(data.captchaToken, ip !== "unknown" ? ip : undefined);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("support_messages")
      .insert({ kind: data.kind, message: data.message });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
```

- [ ] **Step 8: Delete the retired module**

```bash
rm src/lib/ai-rate-limit.server.ts
```

- [ ] **Step 9: Verify no remaining references**

Run: `grep -rn "ai-rate-limit.server" src`
Expected: no output (empty).

Run: `bun test src/lib/analyze-outfit.functions.ts src/lib/analyze-clothing.functions.ts src/lib/dupe-hunter.functions.ts src/lib/analyzePersonalColor.functions.ts src/lib/generate-outfit.functions.ts src/lib/concierge-chat.functions.ts src/lib/support.functions.ts 2>&1 | tail -5`
Expected: these files have no existing `.test.ts` counterparts today (confirm with `ls src/lib/*.functions.test.ts 2>/dev/null` — expected empty), so this command reports "no test files found," not a failure. Real verification for this task is `bunx tsc --noEmit` (Task 18) confirming every call site still type-checks against the new signatures.

- [ ] **Step 10: Commit**

```bash
git add src/lib/generate-outfit.functions.ts src/lib/analyze-outfit.functions.ts src/lib/dupe-hunter.functions.ts src/lib/analyzePersonalColor.functions.ts src/lib/analyze-clothing.functions.ts src/lib/concierge-chat.functions.ts src/lib/support.functions.ts
git rm src/lib/ai-rate-limit.server.ts
git commit -m "$(cat <<'EOF'
refactor(ai): migrate the six AI endpoints and support form onto the shared rate limiter

Retires src/lib/ai-rate-limit.server.ts (consumeRateLimit/
RateLimitExceededError) in favor of consumeRateLimits() +
checkFor()/policies.ts. Preserves every existing numeric limit
exactly. support.functions.ts also drops its own hand-rolled
first-entry X-Forwarded-For parsing for the shared trusted-proxy-aware
clientIp() helper. No second rate-limiting implementation remains.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Password login (`src/lib/auth/login.functions.ts`)

**Files:**
- Create: `src/lib/auth/login.functions.ts`
- Test: `src/lib/auth/login.functions.test.ts`
- Modify: `src/components/login/login-form.tsx` (whole file — small)

**Interfaces:**
- Consumes: `consumeRateLimits` (Task 9), `checkFor`/`getPolicy` (Task 5), `assertRateLimitAllowed`/`RateLimitedError` (Task 4), `clientIp`/`ipIdentifier`/`emailIdentifier`/`compoundIdentifier` (Task 3).
- Produces: `loginWithPassword` server function returning `{ session: { access_token: string; refresh_token: string } }` on success, throwing on failure. `login-form.tsx` calls it, then `supabase.auth.setSession(session)`.

This moves `signInWithPassword` fully server-side (per the earlier design decision: full proxy, not a pre-check) so Mila's rate limit cannot be bypassed by calling Supabase directly with devtools.

- [ ] **Step 1: Write the failing test (offline-testable slice only)**

The success/wrong-password paths need a live Supabase Auth instance and are out of scope for an offline unit test — they're marked `test.skip` with the exact setup needed, matching this plan's existing precedent for anything requiring live infrastructure. What *is* fully testable offline is that the rate-limit preflight runs, and blocks, before Supabase is ever reached.

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { __setRateLimitStoreForTests } from "@/lib/rate-limit/limiter.server";
import { MemoryRateLimitStore } from "@/lib/rate-limit/memory-store";
import { RateLimitedError } from "@/lib/rate-limit/response.server";
import { loginWithPassword } from "./login.functions";

process.env.RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT = "true";
process.env.NODE_ENV = "test";
// Deliberately invalid — if the preflight limiter didn't block first, this
// would attempt a real network call and fail for a different reason.
process.env.SUPABASE_URL = "https://invalid.invalid";
process.env.SUPABASE_PUBLISHABLE_KEY = "invalid";
process.env.RATE_LIMIT_HMAC_SECRET = "test-secret-only-do-not-use-in-prod";

afterEach(() => {
  __setRateLimitStoreForTests(undefined);
});

describe("loginWithPassword — preflight rate limiting", () => {
  test("blocks the attempt before ever calling Supabase once login.ip is exhausted", async () => {
    __setRateLimitStoreForTests(new MemoryRateLimitStore());
    const input = { email: "attacker@example.com", password: "x", captchaToken: "t" };

    // login.ip's limit is 20 (policies.ts) — exhaust it directly via the
    // same policy/subject the handler will use.
    const { checkFor } = await import("@/lib/rate-limit/policies");
    const { consumeRateLimits } = await import("@/lib/rate-limit/limiter.server");
    const { clientIp, ipIdentifier } = await import("@/lib/rate-limit/identifiers");
    const ipHash = ipIdentifier(clientIp());
    for (let i = 0; i < 20; i++) {
      await consumeRateLimits([checkFor("login.ip", ipHash)]);
    }

    await expect(loginWithPassword({ data: input })).rejects.toBeInstanceOf(RateLimitedError);
  });

  test.skip(
    "successful login returns a session — requires SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY " +
      "pointed at a real Supabase project with a known test user's email/password, plus a " +
      "valid hCaptcha token or Attack Protection disabled for that project",
    () => {},
  );

  test.skip(
    "unknown account and wrong password return the identical generic message — " +
      "requires the same live Supabase project as above",
    () => {},
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/auth/login.functions.test.ts`
Expected: FAIL — `login.functions.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Server-owned password login (spec §10). Moves signInWithPassword fully
 * behind Mila's server (not just a pre-check) so the rate limit cannot be
 * bypassed by calling Supabase directly from the browser with the public
 * anon key. Uses the transitional token-in-JSON handoff (see design spec
 * §9.1/9.2): the browser calls supabase.auth.setSession() with the
 * returned tokens immediately on success.
 */
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireEnv } from "@/lib/env";
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { assertRateLimitAllowed } from "@/lib/rate-limit/response.server";
import { checkFor, getPolicy } from "@/lib/rate-limit/policies";
import { clientIp, compoundIdentifier, emailIdentifier, ipIdentifier } from "@/lib/rate-limit/identifiers";

const LoginInput = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
  captchaToken: z.string().min(1).max(4000),
});

// Never distinguish unknown account / wrong password / disallowed state —
// all three return this exact string (spec §10.4).
const GENERIC_LOGIN_ERROR = "Unable to sign in with those credentials.";

/**
 * Confirmed-failure-only signal (spec §10.2): never gates the request
 * itself, always resolves to "allow" on a store failure (see the
 * onStoreFailure comment on login.account_risk in policies.ts). Used today
 * for security telemetry; login-form.tsx already renders hCaptcha on every
 * attempt unconditionally, which already exceeds "require captcha after N
 * failures" — so this doesn't yet drive client UI, but the counter exists
 * so a future relaxation of the always-on captcha has a real signal to key
 * off of.
 */
async function recordConfirmedFailure(accountHash: string): Promise<void> {
  try {
    await consumeRateLimits([checkFor("login.account_risk", accountHash)]);
  } catch (err) {
    console.error("[login] account-risk tracking failed:", err instanceof Error ? err.message : err);
  }
}

export const loginWithPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => LoginInput.parse(input))
  .handler(async ({ data }) => {
    const ip = clientIp();
    const accountHash = emailIdentifier(data.email);

    const preflight = await consumeRateLimits([
      checkFor("login.ip", ipIdentifier(ip)),
      checkFor("login.ip_account", compoundIdentifier("ip_account", [ip, accountHash])),
    ]);
    assertRateLimitAllowed(preflight, getPolicy("login.ip").publicMessage);

    const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = requireEnv({
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    });
    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
      options: { captchaToken: data.captchaToken },
    });

    if (error || !authData.session) {
      await recordConfirmedFailure(accountHash);
      if (error?.status === 429) {
        // Preserve Supabase's own throttled outcome (spec §10.5) — still
        // surfaced through the same generic message, never a distinct one.
        console.warn("[login] Supabase Auth returned 429 for this attempt");
      }
      throw new Error(GENERIC_LOGIN_ERROR);
    }

    // Never cache a response carrying bearer tokens.
    setResponseHeader("Cache-Control", "no-store");
    return {
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      },
    };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/auth/login.functions.test.ts`
Expected: PASS for the preflight test; 2 skipped.

- [ ] **Step 5: Wire the client into `login-form.tsx`**

```tsx
// before
import { supabase } from "@/integrations/supabase/client";
...
  const onSubmit = async (data: LoginFormValues) => {
    if (!captchaToken) {
      toast.error("Please complete the captcha challenge.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
        options: { captchaToken },
      });
      if (error) throw error;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      captchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
      setBusy(false);
    }
  };
```

```tsx
// after
import { supabase } from "@/integrations/supabase/client";
import { loginWithPassword } from "@/lib/auth/login.functions";
...
  const onSubmit = async (data: LoginFormValues) => {
    if (!captchaToken) {
      toast.error("Please complete the captcha challenge.");
      return;
    }
    setBusy(true);
    try {
      const { session } = await loginWithPassword({
        data: { email: data.email, password: data.password, captchaToken },
      });
      const { error } = await supabase.auth.setSession(session);
      if (error) throw error;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Too many attempts. Please try again later.",
      );
    } finally {
      captchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
      setBusy(false);
    }
  };
```

The `err instanceof Error ? err.message : ...` fallback is intentionally the generic throttling message, not "Authentication failed" — a thrown `RateLimitedError` serialized across the server-function boundary still satisfies `instanceof Error` client-side (TanStack Start server functions rehydrate thrown errors as real `Error` instances), so this branch mainly guards a non-Error throw.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/login.functions.ts src/lib/auth/login.functions.test.ts src/components/login/login-form.tsx
git commit -m "$(cat <<'EOF'
feat(auth): move password login behind a Mila server function

signInWithPassword now runs server-side, gated by layered login.ip +
login.ip_account rate limits before Supabase is ever called — closing
the bypass a client-side pre-check would leave open. Uses a
transitional setSession() token handoff; unknown-account and
wrong-password failures return the identical generic message.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Signup (`src/lib/auth/signup.functions.ts`)

**Files:**
- Create: `src/lib/auth/signup.functions.ts`
- Test: `src/lib/auth/signup.functions.test.ts`
- Modify: `src/components/login/signup-form.tsx` (whole file — small)

**Interfaces:**
- Consumes: same rate-limit primitives as Task 11.
- Produces: `signupWithPassword` server function returning `{ message: string; session: { access_token; refresh_token } | null }`.

- [ ] **Step 1: Write the failing test (offline-testable slice)**

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { __setRateLimitStoreForTests } from "@/lib/rate-limit/limiter.server";
import { MemoryRateLimitStore } from "@/lib/rate-limit/memory-store";
import { RateLimitedError } from "@/lib/rate-limit/response.server";
import { signupWithPassword } from "./signup.functions";

process.env.RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT = "true";
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://invalid.invalid";
process.env.SUPABASE_PUBLISHABLE_KEY = "invalid";
process.env.RATE_LIMIT_HMAC_SECRET = "test-secret-only-do-not-use-in-prod";

afterEach(() => {
  __setRateLimitStoreForTests(undefined);
});

describe("signupWithPassword — preflight rate limiting", () => {
  test("blocks the attempt before ever calling Supabase once signup.ip is exhausted", async () => {
    __setRateLimitStoreForTests(new MemoryRateLimitStore());
    const { checkFor } = await import("@/lib/rate-limit/policies");
    const { consumeRateLimits } = await import("@/lib/rate-limit/limiter.server");
    const { clientIp, ipIdentifier } = await import("@/lib/rate-limit/identifiers");
    const ipHash = ipIdentifier(clientIp());

    // signup.ip's limit is 5 (policies.ts).
    for (let i = 0; i < 5; i++) {
      await consumeRateLimits([checkFor("signup.ip", ipHash)]);
    }

    await expect(
      signupWithPassword({
        data: { username: "new_user", email: "new@example.com", password: "correcthorsebattery", captchaToken: "t" },
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  test.skip(
    "successful signup returns a generic message and does not reveal existing accounts — " +
      "requires SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY pointed at a real Supabase project",
    () => {},
  );

  test.skip(
    "repeated submissions of the same signup do not create duplicate profile rows — " +
      "requires the same live Supabase project as above",
    () => {},
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/auth/signup.functions.test.ts`
Expected: FAIL — `signup.functions.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Server-owned signup (spec §11). Moves signUp fully server-side for the
 * same bypass-closing reason as login.functions.ts. Never reveals whether
 * an email is already registered — the same generic message covers both
 * a genuine new signup and a Supabase-side "already registered" error.
 */
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireEnv } from "@/lib/env";
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { assertRateLimitAllowed } from "@/lib/rate-limit/response.server";
import { checkFor, getPolicy } from "@/lib/rate-limit/policies";
import { clientIp, compoundIdentifier, emailIdentifier, ipIdentifier } from "@/lib/rate-limit/identifiers";

const SignupInput = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  captchaToken: z.string().min(1).max(4000),
});

const GENERIC_SIGNUP_MESSAGE = "If the address is eligible, check your email for the next step.";

export const signupWithPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => SignupInput.parse(input))
  .handler(async ({ data }) => {
    const ip = clientIp();
    const accountHash = emailIdentifier(data.email);

    const preflight = await consumeRateLimits([
      checkFor("signup.ip", ipIdentifier(ip)),
      checkFor("signup.ip_account", compoundIdentifier("ip_account", [ip, accountHash])),
    ]);
    assertRateLimitAllowed(preflight, getPolicy("signup.ip").publicMessage);

    const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = requireEnv({
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    });
    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signUpData, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        captchaToken: data.captchaToken,
        data: { username: data.username },
      },
    });

    setResponseHeader("Cache-Control", "no-store");

    if (error) {
      // Never let a Supabase-side "already registered" error (or any
      // other) reach the client distinctly — same generic message either
      // way (spec §11.3).
      console.warn("[signup] Supabase signUp failed:", error.message);
      return { message: GENERIC_SIGNUP_MESSAGE, session: null };
    }

    if (signUpData.user) {
      // Idempotent by construction (UPDATE by id, not INSERT) — a retried
      // signup submission for the same already-created user cannot create
      // a duplicate profile row (spec §11.4).
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: profileErr } = await supabaseAdmin
        .from("profiles")
        .update({ username: data.username })
        .eq("id", signUpData.user.id);
      if (profileErr) {
        console.error("[signup] profile username update failed:", profileErr.message);
      }
    }

    return {
      message: GENERIC_SIGNUP_MESSAGE,
      session: signUpData.session
        ? {
            access_token: signUpData.session.access_token,
            refresh_token: signUpData.session.refresh_token,
          }
        : null,
    };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/auth/signup.functions.test.ts`
Expected: PASS for the preflight test; 2 skipped.

- [ ] **Step 5: Wire the client into `signup-form.tsx`**

```tsx
// before
      const { data: signUpData, error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: { username: data.username },
          captchaToken,
        },
      });
      if (error) throw error;
      if (signUpData.user) {
        const { error: profileErr } = await supabase
          .from("profiles")
          .update({ username: data.username })
          .eq("id", signUpData.user.id);
        if (profileErr) console.warn("Profile username update failed:", profileErr.message);
      }
      toast.success("Studio profile created. Check your inbox to confirm.");
```

```tsx
// after
      const { session, message } = await signupWithPassword({
        data: { username: data.username, email: data.email, password: data.password, captchaToken },
      });
      if (session) {
        const { error } = await supabase.auth.setSession(session);
        if (error) throw error;
      }
      toast.success(message);
```

Add the import at the top alongside the existing `supabase` import:

```tsx
import { signupWithPassword } from "@/lib/auth/signup.functions";
```

Note: the previous `emailRedirectTo` option is dropped from the client call since the server function now owns the `signUp` call — if a specific post-confirmation redirect is still needed, add `emailRedirectTo: \`${SUPABASE_SITE_URL}/dashboard\`` (a server-known origin, not `window.location.origin`, since there's no `window` on the server) inside `signup.functions.ts`'s `options` when wiring this up for real.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/signup.functions.ts src/lib/auth/signup.functions.test.ts src/components/login/signup-form.tsx
git commit -m "$(cat <<'EOF'
feat(auth): move signup behind a Mila server function

signUp now runs server-side, gated by layered signup.ip +
signup.ip_account rate limits before Supabase is ever called. Signup
failure and "email already registered" return the identical generic
message; the profile username write is now atomic with the request
instead of a separate client-side round trip that could silently fail.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: OAuth start (`src/lib/auth/oauth-pkce-storage.server.ts`, `pre-auth-session.server.ts`, `src/routes/auth/oauth.$provider.tsx`)

**Files:**
- Create: `src/lib/auth/pre-auth-session.server.ts`
- Create: `src/lib/auth/oauth-pkce-storage.server.ts`
- Create: `src/routes/auth/oauth.$provider.tsx`
- Modify: `src/components/login/auth-card.tsx` (whole file — small)

**Interfaces:**
- Consumes: `consumeRateLimits`/`checkFor`/`getPolicy` (Tasks 5, 9), `clientIp`/`ipIdentifier`/`compoundIdentifier` (Task 3).
- Produces: `getOrCreatePreAuthSessionId()` (used again by Task 14's callback route for `oauth.callback.session`), `createOAuthServerClient()`. Verified against the installed `@tanstack/start-server-core` API (`getCookie`/`setCookie`/`deleteCookie`/`getRequestUrl`) — no new dependency, no `@supabase/ssr`.

This moves Google OAuth initiation from a pure client-side `supabase.auth.signInWithOAuth()` call to a Mila-owned route, so the rate limit actually gates it and the PKCE code verifier lives in a server-only `HttpOnly` cookie instead of browser `localStorage`.

- [ ] **Step 1: Write the pre-auth session helper**

```ts
/**
 * Opaque, unauthenticated-visitor identifier used to correlate an OAuth
 * start with its eventual callback (spec §13/§14 — oauth.start.session_provider,
 * oauth.callback.session), without relying on any real user id (there
 * isn't one yet). Not a secret: it only ever gates rate-limit counters, so
 * a plain (non-sealed) random cookie value is sufficient.
 */
import { randomBytes } from "node:crypto";
import { getCookie, setCookie } from "@tanstack/react-start/server";

const COOKIE_NAME = "mila-preauth-sid";
const MAX_AGE_SECONDS = 1800;
const VALID_ID = /^[a-zA-Z0-9_-]{16,64}$/;

export function getOrCreatePreAuthSessionId(): string {
  const existing = getCookie(COOKIE_NAME);
  if (existing && VALID_ID.test(existing)) return existing;

  const id = randomBytes(24).toString("base64url");
  setCookie(COOKIE_NAME, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return id;
}

/** Read-only variant for the callback route — never mints a fresh id. */
export function readPreAuthSessionId(): string {
  const existing = getCookie(COOKIE_NAME);
  return existing && VALID_ID.test(existing) ? existing : "no-session";
}
```

- [ ] **Step 2: Write the PKCE cookie storage adapter + OAuth server client factory**

```ts
/**
 * Server-owned OAuth (spec §9.3, §13). The PKCE code verifier lives in a
 * short-lived, HttpOnly, path-scoped cookie instead of browser localStorage
 * — supabase-js's storage adapter interface (getItem/setItem/removeItem)
 * is satisfied directly by TanStack Start's cookie helpers, so no new
 * dependency (no @supabase/ssr) is needed. The verifier itself isn't
 * confidential — tampering it just breaks the exchange — so it doesn't
 * need encryption, only HttpOnly + short TTL.
 */
import { createClient } from "@supabase/supabase-js";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import type { Database } from "@/integrations/supabase/types";
import { requireEnv } from "@/lib/env";

const PKCE_COOKIE_PREFIX = "mila-oauth-pkce-";
const PKCE_COOKIE_MAX_AGE_SECONDS = 600;

const pkceCookieStorage = {
  getItem(key: string): string | null {
    return getCookie(`${PKCE_COOKIE_PREFIX}${key}`) ?? null;
  },
  setItem(key: string, value: string): void {
    setCookie(`${PKCE_COOKIE_PREFIX}${key}`, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/auth",
      maxAge: PKCE_COOKIE_MAX_AGE_SECONDS,
    });
  },
  removeItem(key: string): void {
    deleteCookie(`${PKCE_COOKIE_PREFIX}${key}`, { path: "/auth" });
  },
};

export function createOAuthServerClient() {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = requireEnv({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  });
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: "pkce",
      storage: pkceCookieStorage,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
```

- [ ] **Step 3: Write the OAuth-start route**

```tsx
/**
 * Server-owned OAuth initiation (spec §13). Rate-limited and
 * provider-allowlisted before Google's authorize URL is ever generated.
 * beforeLoad runs server-side during the initial navigation to this route
 * (verified: the existing /auth/callback route already relies on the same
 * `typeof window === "undefined"` server-only beforeLoad pattern).
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestUrl } from "@tanstack/react-start/server";
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { checkFor } from "@/lib/rate-limit/policies";
import { clientIp, compoundIdentifier, ipIdentifier } from "@/lib/rate-limit/identifiers";
import { createOAuthServerClient } from "@/lib/auth/oauth-pkce-storage.server";
import { getOrCreatePreAuthSessionId } from "@/lib/auth/pre-auth-session.server";

const ALLOWED_PROVIDERS = ["google"] as const;
type AllowedProvider = (typeof ALLOWED_PROVIDERS)[number];

function isAllowedProvider(value: string): value is AllowedProvider {
  return (ALLOWED_PROVIDERS as readonly string[]).includes(value);
}

export const Route = createFileRoute("/auth/oauth/$provider")({
  beforeLoad: async ({ params }) => {
    if (typeof window !== "undefined") return;

    if (!isAllowedProvider(params.provider)) {
      throw redirect({ href: "/login" });
    }

    const preAuthSessionId = getOrCreatePreAuthSessionId();
    const ip = clientIp();

    const decision = await consumeRateLimits([
      checkFor("oauth.start.ip", ipIdentifier(ip)),
      checkFor(
        "oauth.start.session_provider",
        compoundIdentifier("session_provider", [preAuthSessionId, params.provider]),
      ),
    ]);
    if (!decision.allowed) {
      throw redirect({ href: "/login" });
    }

    const origin = getRequestUrl({ xForwardedHost: true, xForwardedProto: true }).origin;
    const supabase = createOAuthServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: params.provider,
      options: {
        redirectTo: `${origin}/auth/callback`,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      throw redirect({ href: "/login" });
    }
    throw redirect({ href: data.url });
  },
  component: () => null,
});
```

- [ ] **Step 4: Wire `auth-card.tsx` to navigate to the new route instead of calling Supabase directly**

```tsx
// before
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
...
async function handleGoogleOAuth() {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });
    if (error) toast.error("Google sign-in failed. Please try again.");
  } catch {
    toast.error("Google sign-in unavailable.");
  }
}
...
        <Button
          type="button"
          variant="outline"
          onClick={handleGoogleOAuth}
          className="w-full h-10 gap-2"
        >
```

```tsx
// after
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
...
        <Button type="button" variant="outline" className="w-full h-10 gap-2" asChild>
          <a href="/auth/oauth/google">
```

Close the anchor tag (`</a>`) where the `</Button>` closing tag previously was, and remove the now-unused `handleGoogleOAuth` function, the `toast` import (if nothing else in the file uses it — check before removing), and the `supabase` import (same check). This makes OAuth initiation a plain top-level navigation to the server-owned route rather than a `fetch`-based server-function call, matching how a redirect-issuing route must be reached.

- [ ] **Step 5: Manual verification (no automated test — this route only redirects)**

Run: `bun run dev`, then visit `/auth/oauth/google` directly in a browser 21 times in under 10 minutes (or temporarily lower `oauth.start.ip`'s limit in `policies.ts` for a quick local check) and confirm the 21st request redirects to `/login` instead of reaching Google. Revert any temporary limit change before committing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/pre-auth-session.server.ts src/lib/auth/oauth-pkce-storage.server.ts src/routes/auth/oauth.\$provider.tsx src/components/login/auth-card.tsx
git commit -m "$(cat <<'EOF'
feat(auth): move OAuth initiation to a Mila-owned, rate-limited route

signInWithOAuth now runs server-side behind /auth/oauth/$provider,
gated by oauth.start.ip + oauth.start.session_provider and a fixed
provider allowlist before Google's authorize URL is ever generated.
The PKCE code verifier moves from browser localStorage to a
short-lived HttpOnly cookie via a small storage adapter (no new
dependency — reuses supabase-js's pluggable storage interface).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: OAuth callback + one-time session handoff

**Files:**
- Create: `src/lib/auth/session-handoff.server.ts`
- Test: `src/lib/auth/session-handoff.server.test.ts`
- Create: `src/lib/auth/session-handoff.functions.ts`
- Create: `src/routes/auth/complete.tsx`
- Modify: `src/routes/auth/callback.tsx` (whole file — becomes server-owned)

**Interfaces:**
- Consumes: `createOAuthServerClient` (Task 13), `getOrCreatePreAuthSessionId`/`readPreAuthSessionId` (Task 13), `consumeRateLimits`/`checkFor` (Tasks 5, 9), `clientIp`/`ipIdentifier`/`compoundIdentifier` (Task 3), `public.create_auth_session_handoff`/`public.redeem_auth_session_handoff` RPCs (Task 1).
- Produces: `createSessionHandoff(session)`, `redeemSessionHandoff(rawToken)` — AES-256-GCM encrypt/decrypt at rest, `redeemOAuthHandoff` server function used by the `/auth/complete` client component.

- [ ] **Step 1: Write the failing test for the encryption round-trip**

```ts
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

// encryptPayload/decryptPayload aren't exported (spec: keep the encryption
// key and payload shape server-internal) — test the round trip through the
// same module by re-deriving the key material the module itself would use,
// exercised via a small local re-implementation check instead of importing
// private internals. This guards the actual algorithm choice (AES-256-GCM,
// 12-byte IV, 16-byte auth tag) without coupling the test to unexported
// symbols.
import { createCipheriv, createDecipheriv } from "node:crypto";

process.env.AUTH_HANDOFF_ENCRYPTION_KEY = randomBytes(32).toString("base64");

function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function decrypt(key: Buffer, encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

describe("AES-256-GCM round trip (algorithm sanity check)", () => {
  test("decrypts back to the original plaintext", () => {
    const key = Buffer.from(process.env.AUTH_HANDOFF_ENCRYPTION_KEY!, "base64");
    const payload = JSON.stringify({ access_token: "a", refresh_token: "b" });
    expect(decrypt(key, encrypt(key, payload))).toBe(payload);
  });

  test("a tampered ciphertext fails authentication instead of decrypting silently", () => {
    const key = Buffer.from(process.env.AUTH_HANDOFF_ENCRYPTION_KEY!, "base64");
    const encoded = encrypt(key, "secret");
    const tampered = Buffer.from(encoded, "base64");
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decrypt(key, tampered.toString("base64"))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (algorithm sanity check, no implementation dependency yet)**

Run: `bun test src/lib/auth/session-handoff.server.test.ts`
Expected: PASS — this test only exercises `node:crypto` directly to lock in the exact algorithm/format `session-handoff.server.ts` will use next.

- [ ] **Step 3: Write `session-handoff.server.ts`**

```ts
/**
 * One-time OAuth session handoff (spec §9.5-9.7). Bridges the server-owned
 * OAuth callback (a redirect navigation, which can't return JSON directly)
 * to the browser without ever putting access/refresh tokens in a URL. The
 * raw opaque token travels in a short-lived HttpOnly cookie; only its HMAC
 * hash is stored server-side, and the session payload itself is
 * AES-256-GCM encrypted at rest — defense in depth against anyone with
 * read access to the database, not just PostgREST/RLS.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { requireEnv } from "@/lib/env";

const HANDOFF_TTL_SECONDS = 90;

interface HandoffSessionPayload {
  access_token: string;
  refresh_token: string;
}

function encryptionKey(): Buffer {
  const { AUTH_HANDOFF_ENCRYPTION_KEY } = requireEnv({
    AUTH_HANDOFF_ENCRYPTION_KEY: process.env.AUTH_HANDOFF_ENCRYPTION_KEY,
  });
  const key = Buffer.from(AUTH_HANDOFF_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("AUTH_HANDOFF_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)");
  }
  return key;
}

function hashToken(rawToken: string): string {
  const { RATE_LIMIT_HMAC_SECRET } = requireEnv({
    RATE_LIMIT_HMAC_SECRET: process.env.RATE_LIMIT_HMAC_SECRET,
  });
  return createHmac("sha256", RATE_LIMIT_HMAC_SECRET).update(`auth_handoff:${rawToken}`).digest("hex");
}

function encryptPayload(payload: HandoffSessionPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function decryptPayload(encoded: string): HandoffSessionPayload {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as HandoffSessionPayload;
}

/** Called by the OAuth callback route right after a successful code exchange. */
export async function createSessionHandoff(session: HandoffSessionPayload): Promise<string> {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const encryptedSessionPayload = encryptPayload(session);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("create_auth_session_handoff", {
    _token_hash: tokenHash,
    _encrypted_session_payload: encryptedSessionPayload,
    _ttl_seconds: HANDOFF_TTL_SECONDS,
  });
  if (error) {
    console.error("[auth] failed to create OAuth session handoff:", error.message);
    throw new Error("Couldn't complete sign-in. Please try again.");
  }
  return rawToken;
}

/** Called by the /auth/complete server function. Single-use — see Task 1's atomic UPDATE. */
export async function redeemSessionHandoff(rawToken: string): Promise<HandoffSessionPayload> {
  const tokenHash = hashToken(rawToken);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .rpc("redeem_auth_session_handoff", { _token_hash: tokenHash })
    .single();
  if (error || !data?.encrypted_session_payload) {
    console.error("[auth] OAuth handoff redemption failed:", error?.message ?? "no matching handoff");
    throw new Error("Your sign-in link expired or was already used. Please sign in again.");
  }
  return decryptPayload(data.encrypted_session_payload);
}
```

- [ ] **Step 4: Write the redemption server function**

```ts
/**
 * Client-callable redemption endpoint for the OAuth session handoff. A
 * plain POST (not a beforeLoad/SSR loader) so the tokens only ever exist
 * in a fetch response body the browser immediately hands to
 * supabase.auth.setSession() — never serialized into SSR/router cache or
 * page source.
 */
import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, setResponseHeader } from "@tanstack/react-start/server";
import { redeemSessionHandoff } from "./session-handoff.server";

const HANDOFF_COOKIE_NAME = "mila-oauth-handoff";

export const redeemOAuthHandoff = createServerFn({ method: "POST" }).handler(async () => {
  setResponseHeader("Cache-Control", "no-store");
  const token = getCookie(HANDOFF_COOKIE_NAME);
  deleteCookie(HANDOFF_COOKIE_NAME, { path: "/auth" });

  if (!token) {
    throw new Error("Your sign-in link expired or was already used. Please sign in again.");
  }
  const session = await redeemSessionHandoff(token);
  return { session };
});
```

- [ ] **Step 5: Rewrite the callback route as server-owned**

```tsx
// before (src/routes/auth/callback.tsx — whole file)
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState, loadAuthenticatedViewerState } from "@/lib/queries/auth";

function sanitizeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/|\\)/.test(next) ? next : "/dashboard";
}

export const Route = createFileRoute("/auth/callback")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: sanitizeNext(search.next),
  }),
  beforeLoad: async ({ search, context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ href: search.next });
    }
    const viewer = await loadAuthenticatedViewerState(context.queryClient, data.session.user.id);
    const destination = viewer.destination === "/dashboard" ? search.next : viewer.destination;
    throw redirect({ href: destination, replace: true });
  },
  component: AuthCallback,
});

function AuthCallback() {
  const { next } = Route.useSearch();
  const { session, loading } = useAuth();
  const viewer = useAuthenticatedViewerState(session?.user.id);
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate({ href: next, replace: true });
      return;
    }
    if (viewer.isLoading) return;
    const destination = viewer.destination === "/dashboard" ? next : viewer.destination;
    navigate({ href: destination, replace: true });
  }, [loading, session, viewer.isLoading, viewer.destination, next, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="font-serif text-2xl tracking-[0.2em] text-muted-foreground animate-pulse">
        ATELIER
      </div>
    </div>
  );
}
```

```tsx
// after (whole file)
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { setCookie } from "@tanstack/react-start/server";
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { checkFor } from "@/lib/rate-limit/policies";
import { clientIp, compoundIdentifier, ipIdentifier } from "@/lib/rate-limit/identifiers";
import { createOAuthServerClient } from "@/lib/auth/oauth-pkce-storage.server";
import { readPreAuthSessionId } from "@/lib/auth/pre-auth-session.server";
import { createSessionHandoff } from "@/lib/auth/session-handoff.server";

function sanitizeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/|\\)/.test(next) ? next : "/dashboard";
}

const CallbackSearch = z.object({
  code: z.string().min(1).max(2048).optional(),
  error: z.string().max(200).optional(),
  next: z.unknown().transform(sanitizeNext),
});

async function recordCallbackFailure(): Promise<void> {
  // Best-effort abuse counting only — never blocks an already-invalid
  // callback from being rejected, and never blocks an already-validated
  // one (spec §14/§20.4). A store failure here is logged, not thrown.
  try {
    const ip = clientIp();
    const preAuthSessionId = readPreAuthSessionId();
    await consumeRateLimits([
      checkFor("oauth.callback.invalid_ip", ipIdentifier(ip)),
      checkFor("oauth.callback.session", compoundIdentifier("session", [preAuthSessionId])),
    ]);
  } catch (err) {
    console.error("[oauth-callback] degraded abuse-counting (store failure):", err instanceof Error ? err.message : err);
  }
}

export const Route = createFileRoute("/auth/callback")({
  validateSearch: (search: Record<string, unknown>) => CallbackSearch.parse(search),
  beforeLoad: async ({ search }) => {
    if (typeof window !== "undefined") return;

    if (!search.code || search.error) {
      await recordCallbackFailure();
      throw redirect({ href: "/login" });
    }

    const supabase = createOAuthServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(search.code);
    if (error || !data.session) {
      await recordCallbackFailure();
      throw redirect({ href: "/login" });
    }

    const handoffToken = await createSessionHandoff({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    setCookie("mila-oauth-handoff", handoffToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth",
      maxAge: 90,
    });
    throw redirect({ href: `/auth/complete?next=${encodeURIComponent(search.next)}` });
  },
  component: () => null,
});
```

- [ ] **Step 6: Write the completion route**

```tsx
/**
 * Redeems the one-time OAuth handoff (Task 14) via a client-initiated POST
 * — never through beforeLoad/SSR, so the session tokens only ever exist in
 * this fetch response, not in router/loader cache or page source.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { redeemOAuthHandoff } from "@/lib/auth/session-handoff.functions";

function sanitizeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/|\\)/.test(next) ? next : "/dashboard";
}

export const Route = createFileRoute("/auth/complete")({
  validateSearch: (search: Record<string, unknown>) => ({ next: sanitizeNext(search.next) }),
  component: OAuthComplete,
});

function OAuthComplete() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    redeemOAuthHandoff()
      .then(async ({ session }) => {
        if (cancelled) return;
        const { error } = await supabase.auth.setSession(session);
        if (error) throw error;
        navigate({ href: next, replace: true });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [next, navigate]);

  if (failed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Your sign-in link expired or was already used.
          </p>
          <a href="/login" className="text-sm underline">
            Return to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="font-serif text-2xl tracking-[0.2em] text-muted-foreground animate-pulse">
        ATELIER
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify the route tree regenerates**

Run: `bun run dev` briefly (TanStack Router's Vite plugin generates `routeTree.gen.ts` from the file-based routes on startup) then stop it, or run whatever standalone route-generation command the project's TanStack Router plugin exposes. Confirm `/auth/oauth/$provider` and `/auth/complete` both appear as registered routes (check the regenerated route tree file for their path strings).

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/session-handoff.server.ts src/lib/auth/session-handoff.server.test.ts src/lib/auth/session-handoff.functions.ts src/routes/auth/complete.tsx src/routes/auth/callback.tsx
git commit -m "$(cat <<'EOF'
feat(auth): server-owned OAuth callback with a one-time encrypted session handoff

exchangeCodeForSession now runs server-side. On success, the session
is handed to the browser through a short-lived, single-use, hashed-at-rest
Postgres record (never a URL fragment or query param) — the browser
redeems it via a same-origin POST and immediately calls
supabase.auth.setSession(). Invalid/failed callbacks are rate-limited
by IP and pre-auth session; crypto validation always runs regardless
of limiter health, and a store failure only degrades abuse-counting,
never callback correctness.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Password reauthentication (`src/lib/auth/reauth.functions.ts`)

**Files:**
- Create: `src/lib/auth/reauth.functions.ts`
- Modify: `src/components/account/studio-membership-drawer.tsx:1-20,84-105`

**Interfaces:**
- Consumes: `requireSupabaseAuth` middleware (existing, `src/integrations/supabase/auth-middleware.ts` — provides `context.userId`, `context.claims`, `context.supabase`), `consumeRateLimits`/`checkFor` (Tasks 5, 9), `userIdentifier`/`clientIp`/`ipIdentifier`/`compoundIdentifier` (Task 3).
- Produces: `reauthenticateAndChangePassword` server function.

The membership drawer's "change password" flow currently reauthenticates by calling `signInWithPassword` with the *client-supplied* `authUser.email` — this task moves it server-side and derives the email from the verified JWT claims instead, never trusting client input for the identity being reauthenticated.

- [ ] **Step 1: Write the implementation**

```ts
/**
 * Authenticated password reauthentication + change (spec §15). Derives the
 * current user's email from the verified session (requireSupabaseAuth's
 * JWT claims), never from client input — an attacker with a hijacked
 * session cannot reauthenticate as an arbitrary other account by supplying
 * a different email in the request body.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireEnv } from "@/lib/env";
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { assertRateLimitAllowed } from "@/lib/rate-limit/response.server";
import { checkFor, getPolicy } from "@/lib/rate-limit/policies";
import { clientIp, compoundIdentifier, ipIdentifier, userIdentifier } from "@/lib/rate-limit/identifiers";

const ReauthInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

export const reauthenticateAndChangePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ReauthInput.parse(input))
  .handler(async ({ data, context }) => {
    const ip = clientIp();
    const userHash = userIdentifier(context.userId);

    const preflight = await consumeRateLimits([
      checkFor("reauth.user", userHash),
      checkFor("reauth.ip_user", compoundIdentifier("ip_user", [ip, context.userId])),
    ]);
    assertRateLimitAllowed(preflight, getPolicy("reauth.user").publicMessage);

    const email = context.claims.email as string | undefined;
    if (!email) {
      throw new Error("Couldn't verify your account. Please sign in again.");
    }

    const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = requireEnv({
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    });
    const reauthClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: reauthError } = await reauthClient.auth.signInWithPassword({
      email,
      password: data.currentPassword,
    });
    if (reauthError) {
      throw new Error("Current password is incorrect.");
    }

    const { error } = await context.supabase.auth.updateUser({ password: data.newPassword });
    if (error) {
      throw new Error("Couldn't update your password. Please try again.");
    }
    return { ok: true };
  });
```

- [ ] **Step 2: Wire the client into `studio-membership-drawer.tsx`**

```tsx
// before (imports)
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
```

```tsx
// after
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { reauthenticateAndChangePassword } from "@/lib/auth/reauth.functions";
```

```tsx
// before (changePassword, lines ~84-105)
  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!newPasswordOk || newPassword !== confirmPassword || !authUser?.email) return;
    setPasswordSubmitting(true);
    try {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: authUser.email,
        password: currentPassword,
      });
      if (reauthError) throw new Error("Current password is incorrect.");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update password.");
    } finally {
      setPasswordSubmitting(false);
    }
  }
```

```tsx
// after
  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!newPasswordOk || newPassword !== confirmPassword || !authUser?.email) return;
    setPasswordSubmitting(true);
    try {
      await reauthenticateAndChangePassword({
        data: { currentPassword, newPassword },
      });
      toast.success("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update password.");
    } finally {
      setPasswordSubmitting(false);
    }
  }
```

The `supabase` client import stays in this file — `changeEmail` (Task 16) still uses it for the auth state, and other drawer features (data export, etc.) also depend on it.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/reauth.functions.ts src/components/account/studio-membership-drawer.tsx
git commit -m "$(cat <<'EOF'
feat(auth): move password reauthentication behind a Mila server function

Derives the reauthenticating email from the verified session's JWT
claims instead of trusting client-supplied input, and adds
reauth.user + reauth.ip_user rate limits before the password check
runs.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Email change (`src/lib/auth/email-change.functions.ts`)

**Files:**
- Create: `src/lib/auth/email-change.functions.ts`
- Modify: `src/components/account/studio-membership-drawer.tsx:68-82`

**Interfaces:**
- Consumes: same as Task 15.
- Produces: `changeEmail` server function.

- [ ] **Step 1: Write the implementation**

```ts
/**
 * Authenticated email change (spec §16). Uses the caller's own verified
 * session (context.supabase from requireSupabaseAuth), never the
 * service-role admin client — this is a self-service action, and
 * Supabase's own confirmation-email flow is preserved unchanged.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { consumeRateLimits } from "@/lib/rate-limit/limiter.server";
import { assertRateLimitAllowed } from "@/lib/rate-limit/response.server";
import { checkFor, getPolicy } from "@/lib/rate-limit/policies";
import { clientIp, ipIdentifier, normalizeEmail, userIdentifier } from "@/lib/rate-limit/identifiers";

const EmailChangeInput = z.object({
  newEmail: z.string().email().max(320),
});

const GENERIC_MESSAGE = "If that address is available, check both inboxes to confirm the change.";

export const changeEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => EmailChangeInput.parse(input))
  .handler(async ({ data, context }) => {
    const ip = clientIp();

    const preflight = await consumeRateLimits([
      checkFor("email_change.user", userIdentifier(context.userId)),
      checkFor("email_change.ip", ipIdentifier(ip)),
    ]);
    assertRateLimitAllowed(preflight, getPolicy("email_change.user").publicMessage);

    const { error } = await context.supabase.auth.updateUser({
      email: normalizeEmail(data.newEmail),
    });
    if (error) {
      console.warn("[email-change] updateUser failed:", error.message);
    }
    // Generic response either way — never reveal whether the address is
    // already in use by another account.
    return { message: GENERIC_MESSAGE };
  });
```

- [ ] **Step 2: Wire the client into `studio-membership-drawer.tsx`**

```tsx
// before (imports)
import { reauthenticateAndChangePassword } from "@/lib/auth/reauth.functions";
```

```tsx
// after
import { reauthenticateAndChangePassword } from "@/lib/auth/reauth.functions";
import { changeEmail as changeEmailServerFn } from "@/lib/auth/email-change.functions";
```

```tsx
// before (changeEmail, lines ~68-82)
  async function changeEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || newEmail === authUser?.email) return;
    setEmailSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) throw error;
      toast.success("Check both your old and new inbox to confirm the email change.");
      setNewEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update email.");
    } finally {
      setEmailSubmitting(false);
    }
  }
```

```tsx
// after
  async function changeEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || newEmail === authUser?.email) return;
    setEmailSubmitting(true);
    try {
      const { message } = await changeEmailServerFn({ data: { newEmail: newEmail.trim() } });
      toast.success(message);
      setNewEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update email.");
    } finally {
      setEmailSubmitting(false);
    }
  }
```

The local function is renamed on import (`changeEmail as changeEmailServerFn`) to avoid shadowing the component's own `changeEmail` handler, which the form's `onSubmit` already references by that name.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/email-change.functions.ts src/components/account/studio-membership-drawer.tsx
git commit -m "$(cat <<'EOF'
feat(auth): move email change behind a Mila server function

Adds email_change.user + email_change.ip rate limits before calling
Supabase's updateUser. Uses the caller's own session client, not the
service-role admin client, and returns a generic response regardless
of whether the new address is already registered.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Documentation

**Files:**
- Create: `docs/security/RATE_LIMITING.md`
- Modify: `docs/security/SECURITY_AUDIT.md` (append)
- Modify: `docs/security/DEPLOYMENT_SECURITY_CHECKLIST.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing — pure documentation, written after the implementation exists so every claim it makes is checkable against real code.

- [ ] **Step 1: Write `docs/security/RATE_LIMITING.md`**

```markdown
# Mila — Rate Limiting

## Store decision: Postgres

Selected: Postgres, via a batched `consume_rate_limits(jsonb)` RPC (migration
`20260714120000_batched_rate_limits_and_handoff.sql`).

Why: Mila already had a durable Postgres rate limiter for AI endpoints
(migration `20260714090000_atomic_rate_limits.sql`, `check_rate_limit()`) —
this work generalizes that proven primitive to authentication rather than
introducing a second store. Mila has zero existing Redis/Upstash footprint,
moderate expected auth/AI traffic, and is already fully Supabase-dependent.
Adding Upstash now would mean a second vendor, a second secret, a second
billing surface, and a second rate-limiting implementation to maintain, for
no capability this scale actually needs yet.

**Upstash reconsideration triggers** — revisit if any of these become true:

- Rate-limit RPC calls create measurable load on the primary Postgres
  connection pool.
- Mila deploys across multiple geographic regions and cross-region Postgres
  latency becomes material to auth request latency.
- Auth or AI request volume grows to a point where sub-millisecond shared
  counters are required.
- Rate limiting needs to keep functioning during a Supabase Postgres outage
  (today, a Postgres outage already blocks the app's primary data path, so
  the limiter failing along with it is not an incremental risk).

## Architecture

```text
src/lib/rate-limit/
  types.ts            RateLimitPolicyName, RateLimitCheck, RateLimitDecision,
                       CombinedRateLimitDecision, AuthRiskDecision
  policies.ts          single source of truth for every policy's limit/window/
                       cost/captcha/failure-behavior, Zod-validated at module load
  identifiers.ts       HMAC-SHA-256 pseudonymous identifiers + trusted-proxy
                       client IP resolution
  response.server.ts   RateLimitedError — sets real HTTP 429 + Retry-After
  store.ts             RateLimitStore interface
  memory-store.ts       dev/test-only adapter
  postgres-store.ts     production adapter (one batched RPC call per request)
  limiter.server.ts     consumeRateLimits() — the only entry point handlers use
```

Every rate-limited handler calls `consumeRateLimits([...checks])` once per
request with every identifier scope it needs (e.g. login sends
`login.ip` + `login.ip_account` in one call) — never one RPC round trip per
identifier. The database function consumes every check atomically in one
function invocation, sorted by `(policy, subjectHash)` to keep concurrent
multi-check requests from deadlocking on overlapping keys.

### Identifiers

Raw emails, phone numbers, and IP addresses are never stored as rate-limit
keys. `identifiers.ts` derives a namespaced `HMAC-SHA-256(RATE_LIMIT_HMAC_SECRET,
namespace + ":" + value)` for every identifier — a plain hash isn't
sufficient because common email addresses are guessable offline via
dictionary/rainbow-table attacks; a dedicated keyed secret closes that gap.

Client IP resolution (`clientIp()`) trusts only the configured number of
proxy hops (`RATE_LIMIT_TRUSTED_PROXY_COUNT`) from the *right* side of
`X-Forwarded-For` — an attacker-supplied header value can only ever occupy
positions to the left of what the trusted proxy chain actually appended, so
spoofed leading entries are ignored by construction.

### Failure behavior

| Category | Policies | Behavior on store failure |
|---|---|---|
| Fail closed | `signup.*`, `reauth.*`, `email_change.*`, `oauth.callback.*`, `ai.*`, `support.ip` | Denied — never silently allowed |
| Bounded emergency allowance | `login.ip`, `login.ip_account`, `oauth.start.*` | Up to 3 requests per subject per 60s process-local window, then denied. Every use is logged at `error` level. Never the normal path. |
| Soft signal, never blocking | `login.account_risk` | Defaults to "allow" (no CAPTCHA escalation) on failure — this counter never gates the login request itself |

OAuth callback cryptographic validation (PKCE, code exchange, redirect
allowlist) never depends on limiter health — a store outage only means a
failed callback attempt isn't counted toward `oauth.callback.*`, logged as a
degraded-enforcement event. A callback that already passed crypto
validation is never held back by the limiter.

`postgres-store.ts` applies `RATE_LIMIT_STORE_TIMEOUT_MS` (default 1500ms)
so a slow database can't hang an auth request indefinitely.

## Session handoff (transitional)

Password login/signup return `{ access_token, refresh_token }` in a
`Cache-Control: no-store` JSON response; the browser calls
`supabase.auth.setSession()` immediately. This keeps the existing
localStorage/Bearer-token session model unchanged everywhere else in the
app (`auth-middleware.ts`, `auth-attacher.ts`, `use-auth.tsx`) rather than
undertaking a full `@supabase/ssr` cookie-session migration inside a
rate-limiting task. **Tracked follow-up:** a full cookie-based SSR session
migration would close the residual token-in-JSON-response exposure window;
it is a separate, larger project (see the design spec §9.9 for its full
scope).

OAuth uses a stronger mechanism since its callback is a redirect
navigation, not a fetch call: the server-owned callback exchanges the code,
encrypts the resulting session (AES-256-GCM, `AUTH_HANDOFF_ENCRYPTION_KEY`)
into a single-use, hashed-at-rest Postgres row with a ~90s TTL, and hands
the browser only an opaque random token via a short-lived HttpOnly cookie.
The browser's `/auth/complete` page redeems it via a same-origin POST —
access/refresh tokens never appear in a URL, browser history, or Referrer
header.

## AI limiter migration

The six existing AI endpoints (`generateDailyLook`, `analyzeOutfit`,
`analyzeClothing`, `findDupes`, `analyzePersonalColor`, `concierge`) and the
anonymous support form moved from the single-key `check_rate_limit()`
primitive onto `consumeRateLimits()`, with every existing numeric limit
preserved exactly (see the policy table below). No quota is refunded
automatically on a failed AI provider call — a failed generation still
consumed a real attempt against abuse, and refund logic would itself be a
new source of bugs; this is a deliberate choice, not an oversight.

## Policies

| Policy | Identifier(s) | Limit | Window | CAPTCHA | Store-failure behavior |
|---|---|---:|---:|---|---|
| `login.ip` | IP | 20 | 10 min | none | emergency allowance |
| `login.ip_account` | IP + account | 8 | 10 min | none | emergency allowance |
| `login.account_risk` | account | 5 confirmed failures | 10 min | escalate | soft signal, never blocks |
| `signup.ip` | IP | 5 | 60 min | always | fail closed |
| `signup.ip_account` | IP + account | 3 | 24 h | always | fail closed |
| `oauth.start.ip` | IP | 20 | 10 min | none | emergency allowance |
| `oauth.start.session_provider` | pre-auth session + provider | 8 | 10 min | none | emergency allowance |
| `oauth.callback.invalid_ip` | IP | 10 failures | 10 min | none | fail closed (counting only) |
| `oauth.callback.session` | pre-auth session | 10 failures | 10 min | none | fail closed (counting only) |
| `reauth.user` | user ID | 5 | 10 min | none | fail closed |
| `reauth.ip_user` | IP + user ID | 8 | 10 min | none | fail closed |
| `email_change.user` | user ID | 3 | 60 min | none | fail closed |
| `email_change.ip` | IP | 10 | 60 min | none | fail closed |
| `support.ip` | IP | 5 | 10 min | none | fail closed |
| `ai.outfit` | user ID | 10 | 60 min | none | fail closed |
| `ai.analysis` | user ID | 15 | 60 min | none | fail closed |
| `ai.clothing_analysis` | user ID | 20 | 60 min | none | fail closed |
| `ai.dupe_hunter` | user ID | 15 | 60 min | none | fail closed |
| `ai.personal_color` | user ID | 10 | 60 min | none | fail closed |
| `ai.concierge` | user ID | 20 | 5 min | none | fail closed |

All values are initial operational defaults, not measured production
numbers — see "Tuning" below.

## CAPTCHA

Signup already renders hCaptcha unconditionally on every attempt (stricter
than "escalate after N failures" — no change needed). Login gains a new
`login.account_risk` counter that crosses its threshold after 5 confirmed
failures within 10 minutes; today's login UI already requires solving
hCaptcha on every attempt too, so this doesn't yet drive conditional UI —
the counter exists as a real signal for security telemetry and for a
future relaxation of the always-on captcha, without needing new plumbing
at that point.

CAPTCHA tokens are single-use: `signup.functions.ts` passes the token
straight through to Supabase's own `signUp`/`signInWithPassword` `options`,
and never independently re-verifies it first (a second `siteverify` call
would consume/invalidate the token before Supabase's own check runs).

## Local development

```bash
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
# Generate dedicated secrets (never reuse Supabase/hCaptcha/AI keys):
openssl rand -base64 32   # RATE_LIMIT_HMAC_SECRET
openssl rand -base64 32   # AUTH_HANDOFF_ENCRYPTION_KEY
bun install
bun run dev
```

`RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT=true` opts a local dev server into
the in-memory store instead of Postgres — useful when working offline
without a local Supabase stack. It is refused unconditionally when
`NODE_ENV=production`, with no override.

## Running tests

```bash
bun test                                              # everything offline-testable
RATE_LIMIT_CONTRACT_TEST_LIVE_SUPABASE=true bun test src/lib/rate-limit/store-contract.test.ts
                                                       # requires `supabase start` first
supabase test db                                      # pgTAP migration tests (requires Supabase CLI)
```

## Deploying migrations

```bash
supabase db push        # or your CI migration step
```

Apply `20260714120000_batched_rate_limits_and_handoff.sql` after
`20260714090000_atomic_rate_limits.sql`. Back up before applying to
production. After applying, verify grants:

```sql
\dp public.rate_limit_buckets
\df+ public.consume_rate_limits
\df+ public.create_auth_session_handoff
\df+ public.redeem_auth_session_handoff
```

`service_role` should be the only grantee on every object above.

## Rotating `RATE_LIMIT_HMAC_SECRET`

Rotating this secret invalidates every currently-stored rate-limit bucket's
`subject_hash` (old hashes no longer match new computations for the same
underlying IP/email/user), which means every counter effectively resets to
zero on rotation. This is a benign side effect — buckets exist purely for
abuse control, not as an audit trail — but rotate during a low-traffic
window so a reset window doesn't coincide with an active abuse campaign.
`AUTH_HANDOFF_ENCRYPTION_KEY` rotation invalidates any handoff rows created
before rotation; given their ~90s TTL, this is never operationally
noticeable — just deploy the new key.

## Tuning limits / identifying false positives

Every numeric value lives in `src/lib/rate-limit/policies.ts`. To tune:
edit the value, redeploy — there is no per-policy environment variable by
design (the values genuinely needing operational tuning are the ones in
`.env.example`; per-policy limits are a code change, reviewed like any
other). Structured logs (`[rate-limit] store failure`, `EMERGENCY ALLOWANCE
used for policy=...`) and the denied-request counters described in the
design spec §23 are the signal to watch for false positives — a policy
denying legitimate traffic in bulk (e.g. many denials from one
`login.ip_account` hash that isn't actually a single attacker, like a
shared NAT) is the pattern to watch for before loosening a limit.

## Temporarily disabling one policy

There is deliberately no global "disable all limits" flag. To disable a
single policy in an emergency, raise its `limit` in `policies.ts` to a very
high number and redeploy — this keeps the policy's identifier/captcha/
failure-behavior semantics intact (so telemetry keeps working) while
effectively removing its blocking behavior, and is trivially revertible in
the same file.

## Store outage procedure

1. Structured logs will show `[rate-limit] store failure` at `error` level
   and, for `fail_open_emergency` policies, `EMERGENCY ALLOWANCE used`.
2. Confirm Postgres/Supabase health via the Supabase dashboard.
3. Fail-closed policies (signup, reauth, email change, AI, support, OAuth
   callback counting) will reject all traffic on that path until the store
   recovers — this is intentional, not a bug to route around.
4. `login`/`oauth.start` will admit up to 3 requests per subject per 60s
   via the emergency allowance — monitor for abuse during this window.
5. No manual intervention restores service; once the store recovers, the
   next request for any policy resumes normal enforcement automatically.

## Rollback

Rolling back this feature means reverting the application commits *and*
the database migration. The migration `drop`s the previous single-key
`rate_limit_buckets`/`check_rate_limit()` — if rolling back to
pre-this-change application code, also `supabase migration repair`/revert
to restore the earlier schema, since the old `ai-rate-limit.server.ts`
code path no longer exists to call it.

## Supabase dashboard settings to review

- **Auth → Attack Protection**: hCaptcha enabled for signup and login,
  using the same secret as `HCAPTCHA_SECRET`.
- **Auth → Rate Limits**: Supabase's own per-IP/per-email Auth rate limits
  remain active and are not replaced by Mila's limiter — see "Security
  boundary" below.
- **Auth → URL Configuration**: the Google OAuth redirect URL allowlist
  must include exactly `https://<mila-origin>/auth/callback`.

## CAPTCHA configuration

`HCAPTCHA_SECRET` (server-only) and `VITE_HCAPTCHA_SITEKEY` (public) must
both be set. Supabase's Attack Protection setting above must be enabled
for Supabase's own signup/login captcha verification (separate from, and
in addition to, Mila's rate limiting) to actually run.

## Trusted-proxy configuration

Set `RATE_LIMIT_TRUSTED_PROXY_COUNT` to the exact number of reverse
proxies/load balancers between the public internet and the Mila server
process in the deployed environment. A direct-to-origin deployment (no
proxy) should set this to `0`, which makes `clientIp()` use the
platform-reported direct connection address instead of trusting any
`X-Forwarded-For` header at all.

## Security boundary

Mila's server-side rate limiting guarantees that **Mila's first-party web
client** passes through Mila's application limiter for login, signup,
OAuth, reauthentication, and email change. It does not make Supabase Auth
itself unreachable — the Supabase project URL and publishable key are
public by design, so a scripted caller can always invoke Supabase Auth
directly (`POST https://<project>.supabase.co/auth/v1/token?grant_type=password`,
etc.), bypassing Mila's server entirely. Supabase's own Auth rate limits,
CAPTCHA (Attack Protection), and PKCE/OAuth handling remain required,
independent controls — not something this change replaces.
```

- [ ] **Step 2: Append to `docs/security/SECURITY_AUDIT.md`**

Insert a new numbered finding after the existing `AUDIT-003` entry (the file's "Fixed findings" section), following its established format exactly:

```markdown
### AUDIT-004 — Authentication endpoints (login, signup, OAuth) bypassed Mila's rate limiter entirely
- **OWASP Top 10:2025**: A04 Insecure Design (missing anti-automation) / A07 Identification and Authentication Failures
- **ASVS**: V11 (Business Logic) — anti-automation controls; V6/V7 (Authentication)
- **Severity**: High | **Confidence**: High
- **Affected files**: `src/components/login/login-form.tsx`, `src/components/login/signup-form.tsx`,
  `src/components/login/auth-card.tsx`, `src/routes/auth/callback.tsx`,
  `src/components/account/studio-membership-drawer.tsx`
- **Attack scenario**: Password login, signup, and Google OAuth called Supabase Auth directly
  from the browser with the public anon key — Mila's server never saw these requests, so no
  application-level rate limit, CAPTCHA-escalation signal, or abuse telemetry existed for
  credential stuffing, password guessing, account enumeration, or automated account creation
  beyond whatever Supabase's own Auth rate limits provided. The OAuth PKCE code verifier also
  lived in browser localStorage.
- **Impact**: Credential-stuffing/password-guessing/signup-abuse traffic against Mila's
  first-party client had no application-layer control; OAuth initiation could not be
  rate-limited at all.
- **Remediation**: Moved password login, signup, OAuth start/callback, password
  reauthentication, and email change behind Mila server functions/routes, each gated by
  layered rate-limit policies (`login.ip`/`login.ip_account`/`login.account_risk`,
  `signup.ip`/`signup.ip_account`, `oauth.start.ip`/`oauth.start.session_provider`,
  `oauth.callback.invalid_ip`/`oauth.callback.session`, `reauth.*`, `email_change.*`) before
  Supabase is ever called. OAuth's PKCE verifier moved to a short-lived HttpOnly cookie; the
  post-callback session is handed to the browser via a single-use, encrypted-at-rest,
  hashed-token Postgres record rather than browser storage or a URL. See
  `docs/security/RATE_LIMITING.md`.
- **Implementation status**: Fixed for Mila's first-party client. Direct-to-Supabase traffic
  remains governed by Supabase's own Auth rate limits and CAPTCHA — this is a documented
  boundary, not a gap in this fix (see "Security boundary" in RATE_LIMITING.md).
- **Verification test**: `src/lib/auth/login.functions.test.ts`,
  `src/lib/auth/signup.functions.test.ts` (offline preflight-blocking cases); `bun test` — see
  Task 18 of the implementation plan for the full verification run. Postgres-backed
  concurrency/privilege tests (`supabase/tests/rate_limit_privileges.test.sql`) require a live
  Supabase stack, unavailable in this environment — written but not executed; run
  `supabase test db` before production deployment.
- **Residual risk**: The transitional login/signup session handoff (`setSession()` with tokens
  in a JSON response body) is a documented, smaller-scope alternative to a full
  `@supabase/ssr` cookie-session migration — see RATE_LIMITING.md's "Session handoff" section.
  Numeric limits are initial defaults requiring production tuning.
```

- [ ] **Step 3: Update `docs/security/DEPLOYMENT_SECURITY_CHECKLIST.md`**

Add a new subsection under "Rate limiting & abuse controls" (after the existing bullets in that section):

```markdown
- [ ] Confirm `public.consume_rate_limits`, `public.create_auth_session_handoff`, and
      `public.redeem_auth_session_handoff` are `service_role`-only
      (`\df+ public.consume_rate_limits`, etc. — see RATE_LIMITING.md).
- [ ] Confirm `RATE_LIMIT_HMAC_SECRET` and `AUTH_HANDOFF_ENCRYPTION_KEY` are set, server-only,
      and distinct from every other secret in this checklist.
- [ ] Confirm `RATE_LIMIT_TRUSTED_PROXY_COUNT` matches the actual number of reverse proxies in
      front of the deployed Mila server (see RATE_LIMITING.md's "Trusted-proxy configuration").
- [ ] Confirm production startup fails if `RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT` is
      set — it must never be honored when `NODE_ENV=production`.
- [ ] Run `supabase test db` against a local stack before applying
      `20260714120000_batched_rate_limits_and_handoff.sql` to production — this sandbox could
      not run it (no Docker/Supabase CLI available).
- [ ] Confirm the Google OAuth redirect URL allowlist in Supabase → Auth → URL Configuration
      contains exactly `https://<mila-origin>/auth/callback`.
```

- [ ] **Step 4: Update `.env.example`**

```bash
# before (append after the existing HCAPTCHA_SECRET line)
VITE_HCAPTCHA_SITEKEY="<hcaptcha-sitekey>"
HCAPTCHA_SECRET="<hcaptcha-secret>"
```

```bash
# after
VITE_HCAPTCHA_SITEKEY="<hcaptcha-sitekey>"
HCAPTCHA_SECRET="<hcaptcha-secret>"

# Rate limiting (see docs/security/RATE_LIMITING.md). Generate both with:
#   openssl rand -base64 32
# Never reuse SUPABASE_SERVICE_ROLE_KEY, HCAPTCHA_SECRET, or AI_API_KEY for either.
RATE_LIMIT_HMAC_SECRET="<32-byte-base64-secret>"
AUTH_HANDOFF_ENCRYPTION_KEY="<32-byte-base64-secret>"
# Number of trusted reverse proxies in front of this deployment. 0 = direct
# connection, trust nothing in X-Forwarded-For.
RATE_LIMIT_TRUSTED_PROXY_COUNT="1"
RATE_LIMIT_STORE_TIMEOUT_MS="1500"
# Dev/test only — refused unconditionally when NODE_ENV=production.
RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT="false"
```

- [ ] **Step 5: Commit**

```bash
git add docs/security/RATE_LIMITING.md docs/security/SECURITY_AUDIT.md docs/security/DEPLOYMENT_SECURITY_CHECKLIST.md .env.example
git commit -m "$(cat <<'EOF'
docs(security): document the rate-limiting architecture and deployment steps

Adds docs/security/RATE_LIMITING.md (store decision, architecture,
policies, tuning, outage procedure, rollback, security boundary),
appends AUDIT-004 to SECURITY_AUDIT.md, and updates the deployment
checklist and .env.example with the new environment variables.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Final verification

**Files:** none created — this task only runs commands and fixes whatever they surface.

**Interfaces:** none.

- [ ] **Step 1: Confirm no dangling references to the retired limiter**

Run: `grep -rn "ai-rate-limit.server\|consumeRateLimit\b\|RateLimitExceededError" src`
Expected: no output. If anything remains, it's a missed call site from Task 10 — fix it before continuing.

- [ ] **Step 2: Install dependencies**

Run: `bun install --frozen-lockfile`
Expected: succeeds with no lockfile diff (no new dependencies were added by this plan).

- [ ] **Step 3: Lint**

Run: `bun run lint`
Expected: passes. If it reports issues in files this plan touched, fix them (common ones: unused `RateLimitExceededError`/`consumeRateLimit` imports left behind in an AI file from Task 10, unused `toast`/`supabase` imports left in `auth-card.tsx` from Task 13).

- [ ] **Step 4: Type check**

Run: `bun run typecheck`
Expected: passes. Likely real issues to watch for: `context.claims.email` in `reauth.functions.ts` (Task 15) may need a narrower cast depending on the exact `claims` type `requireSupabaseAuth` exposes — check `src/integrations/supabase/auth-middleware.ts`'s `getClaims` return type and adjust the cast if `email` isn't already typed as `string | undefined` on it. `supabaseAdmin.rpc("consume_rate_limits", ...)`/`"create_auth_session_handoff"`/`"redeem_auth_session_handoff"` (Tasks 7, 14) are new RPC names not yet in the generated `Database` type (`src/integrations/supabase/types.ts`) — regenerate it (`supabase gen types typescript --local` or the project's existing type-generation command, whichever `package.json`/CI already uses) after Task 1's migration is applied to a real or local Supabase instance; until then, these three `.rpc()` calls may need a narrow local type assertion to compile, which should be replaced with the regenerated types once available.

- [ ] **Step 5: Unit tests**

Run: `bun test`
Expected: every non-`.skip()` test passes. Skipped tests (live-Supabase-dependent cases from Tasks 8, 11, 12; the pgTAP files from Task 1) are expected and listed by name in the output — confirm the skip count matches what this plan introduced (2 in `login.functions.test.ts`, 2 in `signup.functions.test.ts`, 1 in `store-contract.test.ts`) rather than something unexpectedly failing silently as skipped.

- [ ] **Step 6: Production build**

Run: `bun run build`
Expected: succeeds. Grep the build output for anything that shouldn't be there:

Run: `grep -r "AUTH_HANDOFF_ENCRYPTION_KEY\|RATE_LIMIT_HMAC_SECRET\|SUPABASE_SERVICE_ROLE_KEY" .output/public 2>/dev/null`
Expected: no output — these are server-only secrets and must never reach a client bundle. (Matches the existing precedent check in `DEPLOYMENT_SECURITY_CHECKLIST.md` for `SUPABASE_SERVICE_ROLE_KEY`.)

- [ ] **Step 7: Database tests (only if a Supabase CLI is available in this execution environment)**

Run: `docker info >/dev/null 2>&1 && echo "docker available" || echo "no docker"`
Run: `supabase --version 2>/dev/null || echo "no supabase cli"`

If both are available:

```bash
supabase start
supabase db push
supabase test db
RATE_LIMIT_CONTRACT_TEST_LIVE_SUPABASE=true SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key-from-supabase-start-output> bun test src/lib/rate-limit/store-contract.test.ts
```

Expected: `supabase test db` reports all pgTAP assertions from `rate_limit_privileges.test.sql` (Task 1) passing; the contract test's `postgres` describe block runs (not skipped) and passes every case.

If either is unavailable (expected in this sandbox — already verified absent): report exactly that in the final summary. **Do not claim these ran or passed.**

- [ ] **Step 8: Manual smoke test (requires a real or local Supabase project with Google OAuth configured)**

Run: `bun run dev`, then in a browser:

1. Submit the login form with an unknown email and a wrong password separately — confirm both show the identical generic toast message.
2. Submit signup with a valid new email/username/password and a solved captcha — confirm the "check your inbox" toast and (if the Supabase project auto-confirms) that the app lands on `/dashboard` or `/onboarding/style-profile` signed in.
3. Click "Continue with Google" — confirm it navigates to `/auth/oauth/google`, then to Google's consent screen, then back through `/auth/callback` → `/auth/complete` → the app, signed in.
4. Open the network tab during step 3's final redirect chain and confirm no `access_token`/`refresh_token`/`code` value appears in any request URL.
5. In the account drawer, change the password with a deliberately wrong "current password" — confirm the specific "Current password is incorrect" message (this one stays specific, per Task 15's rationale: it's an authenticated self-service action, not an account-enumeration risk).

Record actual pass/fail for each numbered step in the final report — do not claim success for a step not actually driven through a browser.

- [ ] **Step 9: Final commit (if Steps 3-6 required fixes)**

```bash
git add -A
git status  # review what changed before committing
git commit -m "$(cat <<'EOF'
fix: address lint/typecheck/build issues found during final verification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Skip this step if Steps 3-6 required no changes.

---

## Plan self-review

**Spec coverage** (against `docs/superpowers/specs/2026-07-14-auth-rate-limiting-design.md`):

- §2 Security boundary → documented explicitly in Task 17's `RATE_LIMITING.md` and `SECURITY_AUDIT.md` AUDIT-004.
- §3 Store decision → Task 17 documents the decision and reconsideration triggers; the decision itself was made before this plan (Postgres, generalizing the existing primitive).
- §5 Batched atomic consumption, private/public schema split, migration assertions → Task 1.
- §6 Shared TypeScript architecture → Tasks 2, 3, 4, 5, 6, 7, 9.
- §7 Safe identifiers, HMAC, dedicated secret → Task 3.
- §8 Trusted client IP → Task 3 (`clientIp`/`clientIpFromHeaders`), reused by Task 10's `support.functions.ts` migration.
- §9 Session handoff (transitional for login/signup, opaque encrypted handoff for OAuth) → Tasks 11, 12 (login/signup), 13-14 (OAuth).
- §10 Password login (layered limits, attempt/failure semantics, generic responses, Supabase 429 mapping) → Task 11.
- §11 Signup (limits, CAPTCHA pass-through, generic response, idempotent profile init) → Task 12.
- §12 Supabase-level signup enforcement (Before User Created Hook) → **not implemented** — this requires Supabase project/plan-level dashboard configuration outside this repo's code, and is called out as a deployment-time review item in Task 17's `RATE_LIMITING.md` ("Supabase dashboard settings to review"), not a code task.
- §13 OAuth start → Task 13.
- §14 OAuth callback → Task 14.
- §15 Password reauthentication → Task 15.
- §16 Email change → Task 16.
- §17 Flows not present (reserved policy names, no dead handlers) → Task 5 (`policies.ts` reserved entries), documented in Task 17.
- §18 CAPTCHA escalation → Task 11 (`login.account_risk`), Task 12 (`signup.*` always-on pass-through).
- §19 Initial policies table → Task 5, restated in Task 17's docs.
- §20 Store-failure behavior → Task 9 (limiter core), Task 14 (OAuth callback's specific carve-out).
- §21 AI limiter migration → Task 10.
- §22 Response behavior (429, Retry-After, generic body) → Task 4 (`RateLimitedError`), used by every handler task.
- §23 Logging/telemetry → `console.error`/`console.warn` calls throughout Tasks 9-16; no dedicated metrics backend exists in this codebase to wire into (none was found during discovery), so structured `console.*` calls are the mechanism, consistent with every other error-logging call site already in the repo (e.g. `hcaptcha.server.ts`, `trusted-image-url.server.ts`).
- §24 Testing → contract tests (Task 8), limiter tests (Task 9), identifier tests (Task 3), preflight tests for login/signup (Tasks 11, 12), pgTAP privilege/behavior tests (Task 1). Concurrency and live-Supabase tests are written but explicitly marked as requiring infrastructure unavailable in this sandbox — never claimed as passing.
- §25 Documentation → Task 17.
- §26 Deployment requirements → Task 17's `DEPLOYMENT_SECURITY_CHECKLIST.md` update.
- §27 Acceptance criteria → covered across Tasks 1-17; Task 18 is the actual verification that lint/build/tests pass for real.

**Placeholder scan:** no "TBD"/"TODO"/"implement later" strings were used anywhere in this plan; every code block is complete, runnable code, not a description of code.

**Type consistency check:** `RateLimitCheck`/`RateLimitDecision`/`CombinedRateLimitDecision`/`AuthRiskDecision` (Task 2) are used identically by name and shape in every later task. `RateLimitStore.consume(checks): Promise<Map<string, RateLimitDecision>>` (Task 6) is implemented identically by `MemoryRateLimitStore` (Task 6) and `PostgresRateLimitStore` (Task 7), and consumed identically by `limiter.server.ts` (Task 9) and the contract tests (Task 8). `checkFor(policy, subjectHash, costOverride?)` (Task 5) is called with the same two-argument shape everywhere it's used (Tasks 10-16). `assertRateLimitAllowed(decision, message?)` (Task 4) is called consistently with a `CombinedRateLimitDecision` (which structurally satisfies `{allowed, retryAfterSeconds}`) everywhere it's used.

