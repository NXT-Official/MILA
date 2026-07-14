# Role / Permission Matrix

Source of truth for the permission model lives in code at
[`src/lib/authorization.ts`](../../src/lib/authorization.ts) (`ROLE_PERMISSIONS`) and is
mirrored by database RLS policies + function grants. This table must stay in sync with
both; when one changes, check the other.

Roles: **Anonymous**, **Member** (authenticated, no staff role), **Moderator**,
**Administrator**, **Suspended** (any account with `profiles.suspended = true`, regardless
of prior role).

| Action | Anonymous | Member | Moderator | Administrator | Suspended |
|---|---|---|---|---|---|
| Public plan reads (active, non-archived only) | ✅ | ✅ | ✅ | ✅ | ❌ (all server fns require an active session) |
| Plan creation | ❌ | ❌ | ❌ | ✅ | ❌ |
| Plan editing | ❌ | ❌ | ❌ | ✅ | ❌ |
| Plan featuring | ❌ | ❌ | ❌ | ✅ | ❌ |
| Plan retirement | ❌ | ❌ | ❌ | ✅ | ❌ |
| Visible feed reads | ❌ | ✅ (own + others' non-hidden) | ✅ | ✅ | ❌ |
| Hidden feed reads | ❌ | ❌ (except own hidden posts) | ✅ | ✅ | ❌ |
| Moderation-reason reads | ❌ | ❌ | ✅ | ✅ | ❌ |
| Hide post (reason required) | ❌ | ❌ | ✅ | ✅ | ❌ |
| Unhide post | ❌ | ❌ | ✅ | ✅ | ❌ |
| Support-message reads | ❌ | ❌ | ✅ | ✅ | ❌ |
| Support-message resolution | ❌ | ❌ | ✅ | ✅ | ❌ |
| Anonymous support submission | ✅ (hCaptcha + IP rate limit) | — | — | — | — |
| Profile reads (own) | ❌ | ✅ | ✅ | ✅ | ❌ |
| Profile reads (others', public fields via feed/profile page) | ❌ | ✅ | ✅ | ✅ | ❌ |
| Member administration (create/edit member) | ❌ | ❌ | ❌ | ✅ | ❌ |
| Staff role changes | ❌ | ❌ | ❌ | ✅ | ❌ |
| Account suspension | ❌ | ❌ | ❌ | ✅ | ❌ |
| Audit-log reads | ❌ | ❌ | ❌ | ✅ (service-role only path; no admin UI reads it directly today — see residual risks) | ❌ |
| AI feature execution (generate/analyze/dupe-hunt/concierge/color) | ❌ | ✅ (own quota) | ✅ | ✅ | ❌ |
| Application settings | ❌ | ❌ | ❌ | ✅ (no settings UI exists yet; reserved) | ❌ |

## Enforcement layers (defense in depth)

Every row above is enforced **twice**, independently:

1. **Server function** — `assertAdmin` / `assertPermission` (from `src/lib/admin.functions.ts`)
   checked against `src/lib/authorization.ts`'s deny-by-default `ROLE_PERMISSIONS` map, using
   roles read fresh from `public.user_roles` + suspension from `public.profiles` on every call.
2. **Database** — RLS policies scoped by `has_role(auth.uid(), 'admin'|'moderator')`, and for
   the highest-risk mutations (role grants, suspension), a `SECURITY DEFINER` function
   (`manage_user_role`, `set_user_suspended`) that re-checks the actor is an active admin
   *inside the function*, independent of whatever called it, with `EXECUTE` restricted to
   `service_role`.

A moderator's permission set (`src/lib/authorization.ts`) is an explicit allowlist —
`moderation.view`, `moderation.manage`, `support.view`, `support.manage`, plus
`admin.access` (gates only "can see the staff area shell", not any specific action) — not
"admin minus a few UI buttons." `members.manage`, `roles.manage`, `subscriptionPlans.manage`,
and suspension are absent from the moderator list, and there is no server function or RLS
policy anywhere that lets a moderator role satisfy those checks.

## Staff MFA (assessment)

Supabase Auth supports TOTP-based MFA (`aal2`) via `supabase.auth.mfa.*`. **Not yet wired
into this app**: no enrollment UI exists, and no server function checks
`session.aal`/`amr` before high-risk staff actions. This is called out as an open item in
SECURITY_AUDIT.md rather than implemented in this pass, because:

- Enforcing `aal2` before every admin/moderator action with zero enrolled admins would
  lock out the only bootstrap path (the `milaadmin@gmail.com` seed in the base migration).
- Building the enrollment UI is a product feature, not a narrowly-scoped security fix.

The safe rollout path (documented, not implemented): add an MFA enrollment screen in
`/admin`, add a `requireStaffMfa()` helper that checks
`(await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).currentLevel === "aal2"` inside
`assertAdmin`/`assertPermission` for the specific high-risk actions listed in Phase 3, but
only after confirming every existing admin has enrolled (e.g. a one-time migration flag or
manual check before flipping the enforcement on).
