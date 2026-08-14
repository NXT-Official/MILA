# Prompt — Extract the staff suite into `MILA_ADMIN`

Paste everything below the line into a fresh Claude Code session started at `/Users/user/nxt`.

---

## Mission

Split MILA's staff suite out of the member app into its own standalone codebase.

- **Create** `/Users/user/nxt/MILA_ADMIN` — a standalone app serving **both** staff roles (admin and moderator).
- **Delete** every admin/moderator/staff route, component, server function, and query from `/Users/user/nxt/MILA/app`, leaving a pure member app.

Both apps talk to the **same Supabase project**. No database migration is written in this task — the schema, RLS policies and RPCs (`user_roles`, `has_role`, `manage_user_role`, `set_user_suspended`, `staff_audit_log`) already support exactly this split.

Work in this order: build and verify `MILA_ADMIN` first, then strip `MILA/app`. Do not delete anything from `MILA/app` until the new app typechecks and boots.

## What you are working with

`MILA/app` is a TanStack Start app: Bun + Vite 7 + React 19 + TanStack Router/Query/Table + Tailwind v4 + shadcn-style components in `src/components/ui`, Supabase for auth/data/storage, `@/*` path alias to `src/*`, tests via `bun test`, `git` repo on branch `allenDev` (clean).

Read these before touching anything — they define the existing staff model:

| File | Why |
|---|---|
| `src/lib/authorization.ts` | Roles, permissions, the two-tree routing model |
| `src/lib/admin.functions.ts` | Every staff server function + `recordStaffAction` audit helper |
| `src/lib/queries/auth.ts` | `loadAuthenticatedViewerState` / destination resolution |
| `src/lib/staff-route.ts`, `src/hooks/use-login-redirect.ts` | Wrong-tree sign-in rejection |
| `src/lib/security-boundaries.test.ts` | The security invariants currently asserted as tests |
| `supabase/migrations/20260706102649_create_full_schema.sql` | `app_role` enum, RLS, `manage_user_role`, `set_user_suspended` |

## Decisions already made — do not re-litigate

1. **Two separate codebases, not a monorepo.** No workspaces, no shared package, no build tooling to link them. Shared files are **copied**. The overlap is ~25 small files; a shared package would cost more than the duplication.
2. **`MILA_ADMIN` is one app for both roles**, gated by permission — not two apps and not the current `/admin` + `/moderator` twin trees. The twin trees existed so each role kept its own URLs inside the member app and neither staff login form leaked the other. A dedicated staff origin makes that structural, so the duplication goes away:
   - `/` — staff sign-in (one form, admins and moderators both)
   - `/dashboard` — `admin.dashboard.view`
   - `/members` — `members.view`
   - `/subscription-plans` — `subscriptionPlans.manage`
   - `/moderation` — `moderation.view`
   - `/support` — `support.view`

   Sidebar renders only links the viewer's permissions allow. Admin lands on `/dashboard`, moderator on `/moderation`.
3. **Keep the permission model verbatim.** `APP_ROLES`, `APP_PERMISSIONS`, `ROLE_PERMISSIONS` move to `MILA_ADMIN` unchanged. Route paths change; permissions do not.
4. **Keep every server-side check.** `assertAdmin` / `assertPermission` / `requireSupabaseAuth` / `recordStaffAction` move as-is. Client-side route guards are UX, not security — the server functions stay the enforcement point.
5. **A non-staff account that signs in to `MILA_ADMIN` is signed back out**, not just redirected — the same `rejectWrongTreeLogin` behaviour that exists today, collapsed to one case.
6. **`MILA/app` loses all role awareness.** No `staffGate` query, no `authorization.ts`, no admin server functions. See "Accepted behaviour changes".

---

# Phase 1 — Build `/Users/user/nxt/MILA_ADMIN`

## 1.1 Scaffold

Create the directory and `git init` it (new repo, not a clone of `MILA/app`). Copy these from `MILA/app` **verbatim**:

```
tsconfig.json          eslint.config.js       .prettierrc
.prettierignore        bunfig.toml            components.json
.gitignore             .github/workflows/ci.yml
public/favicon.svg     public/theme-init.js
src/styles.css         src/router.tsx         src/start.ts
```

`package.json` — same `scripts` block and same dependency **versions**, but drop what the staff suite never touches:

- Remove deps: `@paddle/paddle-js`, `@sanity/client`, `framer-motion` *(only if nothing you copy imports it — `staff-shell.tsx` does; keep it if so)*, `@radix-ui/react-accordion`, `@radix-ui/react-popover`.
- Keep: `@radix-ui/react-dialog|dropdown-menu|label|select|slot|switch|tabs`, `@supabase/supabase-js`, `@tanstack/*` (router, start, query, table, router-plugin), `@hcaptcha/react-hcaptcha`, `@hookform/resolvers`, `react-hook-form`, `zod`, `sonner`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, `tailwindcss`, `@tailwindcss/vite`, `tw-animate-css`, `nitro`, `vite-tsconfig-paths`, plus the whole `devDependencies` block.
- `"name": "mila-admin"`.

`vite.config.ts` — copy, then:

- `server.port: 8081` (8080 is the member app; they must run side by side).
- Trim the CSP: drop `https://cdn.paddle.com`, `https://buy.paddle.com`, `https://sandbox-buy.paddle.com`, `https://api.open-meteo.com`. Keep `'self'`, the Supabase origin, hCaptcha entries, and every security header as-is.
- Keep `frame-ancestors 'none'`, HSTS in prod, and the `Cache-Control: no-store` route rule.

`.env.example`:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=

SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

VITE_HCAPTCHA_SITEKEY=
HCAPTCHA_SECRET=
```

`SUPABASE_SERVICE_ROLE_KEY` is required, not optional: member listing, moderation image signing, and the audit log all go through `supabaseAdmin`. No Paddle, Sanity, AI, or Cloudflare keys — nothing in the staff suite calls them (`subscription-plans.functions.ts` only stores Paddle **ids** as text columns).

Write a real `.env` too, copying the Supabase and hCaptcha values from `MILA/app/.env`.

## 1.2 Copy verbatim (no edits)

```
src/integrations/supabase/client.ts
src/integrations/supabase/client.server.ts
src/integrations/supabase/auth-middleware.ts
src/integrations/supabase/auth-attacher.ts
src/integrations/supabase/types.ts
src/lib/env.ts
src/lib/utils.ts
src/lib/authorization.ts            (then edit — see 1.4)
src/lib/admin.functions.ts
src/lib/subscription-plans.functions.ts
src/lib/subscription-plans.ts
src/lib/auth.functions.ts
src/lib/auth-handler.server.ts
src/lib/auth-input.ts
src/lib/hcaptcha.server.ts
src/lib/rate-limit.server.ts
src/constants/password.ts
src/constants/app.ts
src/hooks/use-auth.ts
src/hooks/use-sign-out.ts
src/components/layout/auth-provider.tsx
src/components/layout/theme-provider.tsx
src/components/layout/theme-toggle.tsx
src/components/layout/suspended-gate.tsx
src/components/login/login-form.tsx
src/components/login/use-captcha.tsx
src/components/staff/staff-header.tsx
src/components/staff/support-columns.tsx
src/components/admin/admin-stat-card.tsx
src/components/admin/member-form-dialog.tsx
src/components/admin/members-columns.tsx
src/components/admin/role-confirmation-dialog.tsx
src/components/admin/subscription-plan-columns.tsx
src/components/admin/subscription-plan-form-dialog.tsx
src/components/admin/table-cells.tsx
tests/helpers/memory-rate-limit-store.ts
```

Plus these `src/components/ui/` files (the closure of what the above import): `badge`, `button`, `card`, `data-table`, `data-table-column-header`, `dialog`, `dropdown-menu`, `empty-state`, `error-state`, `form-field`, `icon-button`, `input`, `label`, `loading-state`, `page-header`, `password-visibility-button`, `select`, `skeleton`, `sonner`, `switch`, `table`, `tabs`, `textarea`.

Do not copy anything not reachable from the staff screens. When `bun run typecheck` reports a missing module, copy that one file — do not copy `src/components/ui` wholesale.

## 1.3 Routes

```
src/routes/__root.tsx                    adapted from MILA/app
src/routes/index.tsx                     staff sign-in
src/routes/_authed.tsx                   guarded shell
src/routes/_authed/dashboard.tsx         from routes/admin/_authed/dashboard.tsx
src/routes/_authed/members.tsx           from routes/admin/_authed/members.tsx
src/routes/_authed/subscription-plans.tsx  from routes/admin/_authed/subscription-plans.tsx
src/routes/_authed/moderation.tsx        component body from components/staff/moderation-page.tsx
src/routes/_authed/support.tsx           component body from components/staff/support-page.tsx
```

`moderation-page.tsx` and `support-page.tsx` exist as separate shared components **only** because both trees mounted them. With one tree, inline each into its route file and drop the indirection.

`__root.tsx`: keep the shell, providers, `ErrorComponent`, `NotFoundComponent`, theme script and font links. Change the `head()` metadata to staff wording (title `Mila — Staff`), and **drop the OpenGraph/Twitter tags** — this app is not shared publicly. Add `<meta name="robots" content="noindex, nofollow">`.

`index.tsx` — the sign-in screen. Adapt `components/staff/staff-login-page.tsx`: one copy block ("Atelier Staff Suite" / "Staff Sign In" / "Stewards and Moderators only."), reusing `LoginForm` and `useCaptcha` unchanged. No signup, no OAuth, no password reset, no link back to the member app.

`_authed.tsx` — merge of `admin/_authed.tsx` and `moderator/_authed.tsx`:

```tsx
export const Route = createFileRoute("/_authed")({
  ssr: false, // session lives in localStorage; the guard can only run client-side
  beforeLoad: async ({ context }) => {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) throw redirect({ to: "/", replace: true });
    const viewer = await loadStaffViewerState(context.queryClient, userId);
    if (!viewer.canAccessStaffArea) throw redirect({ to: "/", replace: true });
  },
  component: () => (
    <SuspendedGate>
      <StaffShell />
    </SuspendedGate>
  ),
});
```

Keep the `ssr: false` comment — without it the server SSRs the match as success and `beforeLoad` never re-runs on hydration, so the tree renders signed out.

Each leaf route additionally enforces its own permission in `beforeLoad` via the surviving `requireStaffRoutePermission` helper (see 1.4). A moderator deep-linking `/members` must be redirected to `/moderation`, not shown a blank table.

## 1.4 Files that need editing after the copy

**`src/lib/authorization.ts`** — keep `APP_ROLES`, `APP_PERMISSIONS`, `ROLE_PERMISSIONS`, `isAppRole`, `getPermissions`, `hasPermission` untouched. Replace the routing block:

```ts
export const STAFF_ROUTE_PERMISSIONS = {
  "/dashboard": "admin.dashboard.view",
  "/members": "members.view",
  "/subscription-plans": "subscriptionPlans.manage",
  "/moderation": "moderation.view",
  "/support": "support.view",
} as const satisfies Record<string, AppPermission>;

/** Where a viewer lands after sign-in: the first route their permissions open. */
export function staffHome(roles: readonly AppRole[]): string { ... }
```

Delete `staffBase()` and `MODERATOR_HOME` — with one tree they have nothing to choose between.

**`src/lib/queries/auth.ts`** → rewrite as a small `loadStaffViewerState` / `useStaffViewerState` pair backed by `staffGateQueryOptions()`. Drop everything member-specific: `profileQueryOptions`, `isStyleProfileComplete`, `toStyleProfileRow`, `AuthenticatedDestination`, `resolveAuthenticatedDestination`. `destination` becomes `staffHome(roles)`.

**`src/lib/queries/admin.ts`** — copy as-is; it only needs the import path for `admin.functions` to resolve.

**`src/lib/staff-route.ts`** — collapse to two exports:

```ts
/** Undoes a sign-in by a non-staff account, cache and all — redirecting alone would
    leave this form a working entry point for member credentials. */
export async function rejectNonStaffLogin(queryClient: QueryClient) { ... }  // signOut + clear + toast
export async function requireStaffRoutePermission(queryClient, permission) { ... }  // unchanged logic
```

Delete `LoginTree` and `WRONG_TREE_NOTICE`. The single message is `"This sign-in is for Mila staff only."`

**`src/hooks/use-login-redirect.ts`** — drop the `tree` parameter and the three-way `belongsHere` map. One rule: signed in **and** `canAccessStaffArea` → `navigate({ to: staffHome })`; signed in **without** it, on a sign-in performed here → `rejectNonStaffLogin` and stay. Keep the `arrivedSignedIn` ref — someone arriving with a live session is sent on, not signed out.

**`src/components/staff/staff-sidebar.tsx`** — the `STAFF_LINKS` array collapses from 7 entries (two trees) to 5 (`/dashboard`, `/members`, `/subscription-plans`, `/moderation`, `/support`), filtered by `hasPermission(roles, permission)` only. Delete the `staffBase` / `to.startsWith(base)` filter. Keep the "Admin Suite" vs "Moderation Suite" heading and the Steward/Moderator badge — they still distinguish the two roles.

**`src/components/staff/staff-shell.tsx`** — same logic, pointed at the new paths; `viewer.destination` becomes `staffHome(viewer.roles)`. Keep the `Restricted` fallback panel and the per-path permission re-check.

**`src/constants/query-keys.ts`** — write a new file with only the staff keys: `staffGate`, `adminUsers`, `adminPosts`, `adminSupportMessages`, `adminDashboard`, `adminSubscriptionPlans`.

**`src/routes/_authed/members.tsx`** — the members table shows role toggles for `admin` and `moderator`; both stay. This screen is the only way to grant or revoke a staff role, so it must remain admin-only (`members.view` + `roles.manage`).

## 1.5 Tests to bring across

Port these to the new structure — they encode invariants the split must not lose:

- `src/lib/security-boundaries.test.ts` — rewrite for one tree. Keep and adapt: the browser Supabase client never touches `SERVICE_ROLE`; password auth stays server-side; suspended accounts are blocked (`<SuspendedGate>`); the captcha hook resets tokens; every form goes through `useCaptcha()`. Add one new assertion: `_authed.tsx` gates on `canAccessStaffArea` and each leaf route names its own permission from `STAFF_ROUTE_PERMISSIONS`.
- `src/lib/rate-limit.server.test.ts`, `src/lib/hcaptcha.server.test.ts`, `src/lib/utils.test.ts` — copy as-is.
- New: a table-driven test over `ROLE_PERMISSIONS` asserting a moderator resolves to `/moderation`, an admin to `/dashboard`, and that a moderator fails `hasPermission` for `members.view` and `subscriptionPlans.manage`.

## 1.6 Verify Phase 1

```
cd /Users/user/nxt/MILA_ADMIN
bun install
bun run lint && bun run typecheck && bun test && bun run build
bun run dev          # http://localhost:8081
```

Manual pass, using the seeded accounts in the schema migration:

| Account | Expect |
|---|---|
| `milaadmin@gmail.com` | `/` → `/dashboard`; all 5 sidebar links; members + plans editable |
| `milamoderator@gmail.com` | `/` → `/moderation`; only Moderation + Support in sidebar; `/members` and `/dashboard` redirect to `/moderation` |
| `milauser@gmail.com` (no staff role) | Sign-in refused, session dropped, error toast, stays on `/` |
| Suspended staff account | `SuspendedGate` blocks the whole tree |

Also confirm: hide/restore/delete a post writes a `staff_audit_log` row; resolving a support message writes one; moderation images render (signed URLs).

---

# Phase 2 — Strip `/Users/user/nxt/MILA/app`

Only start once Phase 1 verifies. Do it on a branch off `allenDev`.

## 2.1 Delete outright

```
src/routes/admin/                         (whole dir — 7 files)
src/routes/moderator/                     (whole dir — 4 files)
src/components/admin/                     (whole dir — 7 files)
src/components/staff/                     (whole dir — 7 files)
src/lib/admin.functions.ts
src/lib/authorization.ts
src/lib/staff-route.ts
src/lib/queries/admin.ts
src/lib/subscription-plans.functions.ts
src/hooks/use-login-redirect.ts
src/lib/queries/auth.test.ts              (rewrite — see 2.2)
```

## 2.2 Edit

**`src/lib/queries/auth.ts`** — remove the staff gate entirely. `AuthenticatedViewerState` keeps only `isStyleProfileComplete` and `destination`; `resolveAuthenticatedDestination` becomes:

```ts
export function resolveAuthenticatedDestination(input: { isStyleProfileComplete: boolean }) {
  return input.isStyleProfileComplete ? "/dashboard" : "/onboarding/style-profile";
}
```

Drop `staffGateQueryOptions`, `isAdmin`, `isModerator`, `canAccessStaffArea`, `roles`, `permissions`, `hasPermission`. `loadAuthenticatedViewerState` now needs only the profile query — the `Promise.all` collapses to one call.

**`src/lib/queries/auth.test.ts`** — rewrite for the two remaining cases (complete → `/dashboard`, incomplete → `/onboarding/style-profile`). Delete the staff cases.

**`src/lib/security-boundaries.test.ts`** — delete the four staff tests (`each staff tree admits only its own role`, `no member-facing path ever redirects to a staff login`, `each login form accepts exactly one role…`, `moderation and support are mounted twice but implemented once`). Keep the rest. In `a suspended account is blocked…`, drop the two staff paths and keep `../routes/_authenticated.tsx`.

**`src/routes/login.tsx`** — `useLoginRedirect("member")` is gone. Replace with a small local effect: signed in → `navigate({ to: viewer.destination })`. Nothing to reject any more.

**`src/routes/auth/callback.tsx`** — delete both `canAccessStaffArea` branches (the `beforeLoad` guard and the effect) along with the `rejectWrongTreeLogin` / `WRONG_TREE_NOTICE` imports. The callback keeps `sanitizeNext` and the destination logic.

**`src/components/layout/app-shell.tsx`** — drop the `staff={...}` prop passed to `<DesktopNav>` (around line 138).

**`src/components/layout/desktop-nav.tsx`** — remove the `staff` prop, its type, and the conditional `<Link>` block (lines 17, 23, 51–54), plus the `AuthenticatedDestination` type import.

**`src/components/landing/site-header.tsx`** — remove the `staffGateQueryOptions` query and `MODERATOR_HOME` import. `destination` becomes `session ? "/dashboard" : "/login"`, `label` becomes `session ? "Dashboard" : "Sign in"`.

**`src/lib/posts.functions.ts`** — lines 5 and 6 import `getCurrentUserRoles` and `hasPermission`; both are already unused. Delete both lines.

**`src/lib/queries/subscription-plans.ts`** — delete `adminSubscriptionPlansQueryOptions` and the `adminListSubscriptionPlans` import. Keep `publicSubscriptionPlansQueryOptions` (the `/pricing` page uses it).

**`src/constants/query-keys.ts`** — delete `staffGate`, `adminUsers`, `adminPosts`, `adminSupportMessages`, `adminDashboard`, `adminSubscriptionPlans`. Keep `subscriptionPlans` (public pricing).

**`src/.env.example` / `.env`** — delete `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `MODERATOR_EMAIL`, `MODERATOR_PASSWORD`. Keep `USER_*`.

**`package.json`** — drop `@tanstack/react-table` **only if** nothing member-facing still imports it. Grep first.

## 2.3 Keep — do not touch

- `src/lib/support.functions.ts` (`submitSupportMessage`) and `src/components/login/support-dialog.tsx` — members file help/feedback; `MILA_ADMIN` reads the resulting rows.
- `src/components/layout/suspended-gate.tsx` and `src/constants/app.ts` (`STEWARD_EMAIL`) — members still get suspended, and the panel's mailto is the only staff contact left.
- `src/lib/subscription-plans.ts` — shared schemas/types; `/pricing` needs it.
- The `hidden` filter in `getFeed` (`posts.functions.ts:159`) — moderation happens in the other app but the effect is member-facing.
- `supabase/migrations/**` — the schema stays owned by this repo and is unchanged.
- `src/lib/account.functions.ts` — its local `admin()` helper is just the service-role client, unrelated to staff roles.

## 2.4 Verify Phase 2

```
cd /Users/user/nxt/MILA/app
bun run lint && bun run typecheck && bun test && bun run build
bun run dev
```

Then: `grep -rn "admin\|moderator\|staff\|Steward" src --include="*.ts" --include="*.tsx"` should return only `STEWARD_EMAIL`, the `suspended-gate` mailto, `account.functions.ts`'s local `admin()` helper, the generated `routeTree.gen.ts`, and `integrations/supabase/types.ts` (generated DB types still describe `user_roles` / `staff_audit_log` — that's correct, the tables still exist).

`src/routeTree.gen.ts` is generated — let the router plugin rewrite it on `bun run dev` or `bun run build`, do not hand-edit.

Sign in as `milauser@gmail.com`: onboarding → dashboard → feed → concierge → pricing all work, and the nav shows no staff link. Sign in as `milaadmin@gmail.com` on the member app: they are treated as an ordinary member (see below).

---

## Accepted behaviour changes

State these plainly in the final summary; do not try to preserve them:

1. **Staff accounts can use the member app as ordinary members.** Today the member login and OAuth callback refuse them. After the split, `MILA/app` has no role awareness, so a staff sign-in there behaves like any member sign-in. RLS still grants those accounts broader table reads, but no member-app UI or server function exposes that — every admin server function moved out. If this is unacceptable, say so before starting; the fix is keeping `getStaffAuthorization` and a one-line refusal in `MILA/app`, at the cost of retaining the gate query and `authorization.ts`.
2. **Staff URLs change**: `/admin/dashboard` → `/dashboard`, `/moderator/moderation` → `/moderation`, on a different origin/port. Any bookmark or documented link needs updating.
3. **`/admin` and `/moderator` on the member origin become 404s.** Do not add redirects — pointing at the staff app from the public origin re-creates exactly the leak the twin-tree design was avoiding.

## Docs to update

- `MILA/app/README.md` — the "Admin System" section, the `/admin/*` and `/moderator/*` rows in "Application Routes", the staff paragraphs under "Authentication and Authorization", the `src/components/admin/` line in "Project Structure", and the admin/moderator rows in "Product Capabilities". Replace with a short pointer to `MILA_ADMIN`. Note: the README already drifts (it references a `/staff` route that no longer exists) — fix what you touch, don't rewrite the file.
- `MILA_ADMIN/README.md` — new, and short: purpose, stack, env vars, `bun install && bun run dev` on 8081, the route/permission table, the shared-Supabase note, and the warning that `src/integrations/supabase/types.ts` is duplicated in both repos and must be regenerated in both after any migration.

## Out of scope

Do not: change the database schema, RLS policies, or RPCs; alter the permission model; redesign any staff screen; set up CI/CD or deployment for `MILA_ADMIN` beyond copying `ci.yml`; touch `MILA/studio-mila` or `MILA_MOBILE`; build a shared package; commit or push without being asked.

## Report back

- Files created in `MILA_ADMIN` (count + the notable ones), files deleted from `MILA/app`, files edited in each.
- Verification output: lint / typecheck / test / build results for **both** repos, pasted, not summarised.
- Anything you found that this prompt got wrong, and what you did instead.
