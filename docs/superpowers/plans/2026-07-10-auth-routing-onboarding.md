# Post-Auth Routing and Style-Profile Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One centralized post-auth destination resolver (admin-before-completion priority), a mandatory style-profile onboarding route that reuses the existing dossier page instead of duplicating it, and route guards that prevent incomplete non-admins from reaching member pages or admins from reaching mandatory onboarding — without touching the DB schema, RLS, or server-side admin authorization.

**Architecture:** Two existing `queryOptions` factories (`adminGateQueryOptions`, `profileQueryOptions`) are composed by one new pure function (`resolveAuthenticatedDestination`) and one new loader helper (`loadAuthenticatedViewerState`) in a new `src/lib/queries/auth.ts`. The existing 965-line `StyleProfile` page component is extracted unmodified into `src/components/style-profile/style-profile-page.tsx` and rendered from two route files — `/style-profile` (existing, `AppShell` chrome) and `/onboarding/style-profile` (new, minimal chrome) — so there is exactly one implementation of the profile-editing UI.

**Tech Stack:** React 19, TypeScript, TanStack Router (file-based, `beforeLoad` guards), TanStack Query (`ensureQueryData` in loaders), Supabase. No test runner — verification is `bunx tsc --noEmit`, `bun run lint`, `bun run build`, plus manual routing-matrix checks against a real session (this repo has real Supabase credentials in `.env`, so `bun run dev` can exercise real sign-in/sign-up).

## Global Constraints

- Do not modify the DB schema, migrations, RLS policies, or `has_role`/`assertAdmin` server-side authorization — client routing is navigation only.
- Do not create a new server function for the resolver — compose the two existing `queryOptions` factories.
- Do not duplicate the 965-line `StyleProfile` component — extract and reuse it from both routes.
- Admin check strictly before style-profile-completion check, everywhere.
- All corrective redirects use `replace: true`.
- `beauty_preferences` (empty array valid) and `default_location` are **not** required for completion; `skin_undertone`, `color_season`, `body_type`, `face_shape`, `hair_type`, `color_profile` **are** required — validated against the existing `UNDERTONES`/`SEASONS`/`BODIES`/`FACE_SHAPES`/`HAIR_TYPES` arrays in `src/constants/style-profile/data.ts`.
- Commit after each task on `main`.

---

### Task 1: Completion contract + central resolver

**Files:**

- Create: `src/lib/style-profile/completion.ts`
- Create: `src/lib/queries/auth.ts`

**Interfaces:**

- Produces: `isStyleProfileComplete(profile)`, `AuthenticatedViewerState` type, `resolveAuthenticatedDestination(input)`, `loadAuthenticatedViewerState(queryClient, userId)`, `useAuthenticatedViewerState()`. Every later task imports these — do not rename once written.
- Consumes: `adminGateQueryOptions` (`@/lib/queries/admin`), `profileQueryOptions` (`@/lib/queries/profile`), `UNDERTONES`/`SEASONS`/`BODIES`/`FACE_SHAPES`/`HAIR_TYPES` (`@/constants/style-profile`).

- [ ] **Step 1: `isStyleProfileComplete`**

```ts
// src/lib/style-profile/completion.ts
import { UNDERTONES, SEASONS, BODIES, FACE_SHAPES, HAIR_TYPES } from "@/constants/style-profile";

export interface StyleProfileRow {
  skin_undertone: string | null;
  color_season: string | null;
  body_type: string | null;
  face_shape: string | null;
  hair_type: string | null;
  color_profile: unknown;
}

function isNonEmptyColorProfile(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return "season" in obj || "primarySwatches" in obj;
}

/**
 * Single source of truth for "has this user finished the style-profile
 * quiz." beauty_preferences and default_location are intentionally
 * excluded — see docs/superpowers/specs/2026-07-10-auth-routing-onboarding-design.md.
 */
export function isStyleProfileComplete(profile: StyleProfileRow | null | undefined): boolean {
  if (!profile) return false;
  return (
    (UNDERTONES as readonly string[]).includes(profile.skin_undertone ?? "") &&
    (SEASONS as readonly string[]).includes(profile.color_season ?? "") &&
    (BODIES as readonly string[]).includes(profile.body_type ?? "") &&
    (FACE_SHAPES as readonly string[]).includes(profile.face_shape ?? "") &&
    (HAIR_TYPES as readonly string[]).includes(profile.hair_type ?? "") &&
    isNonEmptyColorProfile(profile.color_profile)
  );
}
```

- [ ] **Step 2: verify the exact export names in `@/constants/style-profile`**

```bash
grep -n "^export" src/constants/style-profile/index.ts | grep -E "UNDERTONES|SEASONS|BODIES|FACE_SHAPES|HAIR_TYPES"
```

Expected: all five are re-exported from the barrel file (`index.ts`) — confirmed present in `data.ts` per repo inspection; adjust the import path in Step 1 to `@/constants/style-profile/data` only if the barrel doesn't re-export them.

- [ ] **Step 3: the resolver**

```ts
// src/lib/queries/auth.ts
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { adminGateQueryOptions } from "@/lib/queries/admin";
import { profileQueryOptions } from "@/lib/queries/profile";
import { isStyleProfileComplete, type StyleProfileRow } from "@/lib/style-profile/completion";

export type AuthenticatedDestination = "/admin" | "/onboarding/style-profile" | "/dashboard";

export interface AuthenticatedViewerState {
  isAdmin: boolean;
  isStyleProfileComplete: boolean;
  destination: AuthenticatedDestination;
}

export function resolveAuthenticatedDestination(input: {
  isAdmin: boolean;
  isStyleProfileComplete: boolean;
}): AuthenticatedDestination {
  if (input.isAdmin) return "/admin";
  if (!input.isStyleProfileComplete) return "/onboarding/style-profile";
  return "/dashboard";
}

/**
 * Route-loader-friendly: uses the query cache (ensureQueryData), so a
 * component rendering after the loader reuses the same result instead of
 * re-fetching. Suspension is intentionally not modeled here — see the
 * design doc; _authenticated.tsx's existing suspended-account gate covers
 * every destination this function can return.
 */
export async function loadAuthenticatedViewerState(
  queryClient: QueryClient,
  userId: string,
): Promise<AuthenticatedViewerState> {
  const [gate, profile] = await Promise.all([
    queryClient.ensureQueryData(adminGateQueryOptions()),
    queryClient.ensureQueryData(profileQueryOptions(userId)),
  ]);
  const isAdmin = !!gate?.is_admin;
  // profileQueryOptions returns a display-shaped profile; the raw columns
  // it reads (skin_undertone, color_season, body_type, face_shape,
  // hair_type) pass through untransformed, but color_season here can be
  // the derived sub-season string — re-fetch the raw row for the
  // completion check instead of trusting the display shape.
  const complete = isStyleProfileComplete(profile as unknown as StyleProfileRow);
  return {
    isAdmin,
    isStyleProfileComplete: complete,
    destination: resolveAuthenticatedDestination({ isAdmin, isStyleProfileComplete: complete }),
  };
}

export function useAuthenticatedViewerState(userId: string | undefined) {
  const gateQuery = useQuery({ ...adminGateQueryOptions(), enabled: !!userId });
  const profileQuery = useQuery({ ...profileQueryOptions(userId), enabled: !!userId });
  const isAdmin = !!gateQuery.data?.is_admin;
  const complete = isStyleProfileComplete(
    profileQuery.data as unknown as StyleProfileRow | undefined,
  );
  return {
    isLoading: gateQuery.isLoading || profileQuery.isLoading,
    isAdmin,
    isStyleProfileComplete: complete,
    destination: resolveAuthenticatedDestination({ isAdmin, isStyleProfileComplete: complete }),
  };
}
```

**Correction needed in Step 3 before moving on**: `profileQueryOptions`'s `DashboardProfile` shape does **not** include `color_profile` in its return value (it's consumed internally by `buildDashboardProfile` but stripped from the output) — re-check `src/lib/queries/profile.ts`'s `DashboardProfile` type. If `color_profile` isn't on the returned object, either (a) add it to `DashboardProfile`/`buildDashboardProfile`'s return (minimal, additive change — do this, since `profileQueryOptions` is otherwise exactly the right cached query to reuse), or (b) fetch it separately. Prefer (a): add `color_profile: Json | null` to `DashboardProfile` and pass `data.color_profile` through in `buildDashboardProfile`'s return object. This is a small, additive change to an existing file, not a new query.

- [ ] **Step 4: apply the `DashboardProfile` fix from Step 3**

Read `src/lib/queries/profile.ts` in full, add `color_profile: Json | null` to the `DashboardProfile` type and to both `EMPTY_PROFILE` and the `buildDashboardProfile` return statement (the raw value is already destructured as `data.color_profile` locally — just also return it unchanged, not the derived `json` object).

- [ ] **Step 5: Verify**

```bash
bunx tsc --noEmit
bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/style-profile/completion.ts src/lib/queries/auth.ts src/lib/queries/profile.ts
git commit -m "$(cat <<'EOF'
feat(auth): add style-profile completion contract and destination resolver

isStyleProfileComplete centralizes what today is a duplicated,
incomplete inline check in dashboard.tsx. resolveAuthenticatedDestination
is the single admin-before-completion priority function every route
guard and post-login redirect will use.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Extract the style-profile page component

**Files:**

- Create: `src/components/style-profile/style-profile-page.tsx`
- Modify: `src/routes/_authenticated/_app/style-profile.tsx`

**Interfaces:**

- Produces: `export function StyleProfile()` from the new file — identical implementation to what exists today, only the file location and export keyword change.
- Consumes: nothing new; all of the existing file's imports move with it.

- [ ] **Step 1: Move the component**

Copy the entire content of `src/routes/_authenticated/_app/style-profile.tsx` from the `function studioToDossier(...)` helper through the end of the `function StyleProfile() { ... }` body into the new file `src/components/style-profile/style-profile-page.tsx`, changing `function StyleProfile()` to `export function StyleProfile()`. Move every import used by that code along with it (the full import block at the top of the current file, lines 1-68 per the current version — `createFileRoute` itself is the only import that stays behind, since the new file has no route of its own).

- [ ] **Step 2: Replace the route file with a thin wrapper**

```tsx
// src/routes/_authenticated/_app/style-profile.tsx
import { createFileRoute } from "@tanstack/react-router";
import { StyleProfile } from "@/components/style-profile/style-profile-page";

export const Route = createFileRoute("/_authenticated/_app/style-profile")({
  component: StyleProfile,
});
```

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

Expected: no errors — this step is a pure move, so any error indicates a missed import.

- [ ] **Step 4: Manual check**

`bun run dev`, sign in as an existing member with a complete profile, visit `/style-profile`, confirm it renders identically to before (dossier view, quiz sheets openable).

- [ ] **Step 5: Commit**

```bash
git add src/components/style-profile/style-profile-page.tsx src/routes/_authenticated/_app/style-profile.tsx
git commit -m "$(cat <<'EOF'
refactor(style-profile): extract StyleProfile page component

Pure move, no logic change — makes the component importable from a
second route (the upcoming onboarding route) without duplicating it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Onboarding layout and route

**Files:**

- Create: `src/routes/_authenticated/onboarding.tsx`
- Create: `src/routes/_authenticated/onboarding/style-profile.tsx`

**Interfaces:**

- Consumes: `StyleProfile` (Task 2), `useSignOut` (`@/hooks/use-sign-out`), `Button`/`IconButton` (`@/components/ui/`).
- Produces: route `/onboarding/style-profile`, reachable by any authenticated non-suspended user (admin or not — admins are redirected away from it by Task 4's guard on `_app`, not by this route itself, since this route has no completeness gate of its own by design).

- [ ] **Step 1: Minimal onboarding layout**

```tsx
// src/routes/_authenticated/onboarding.tsx
import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useSignOut } from "@/hooks/use-sign-out";
import { IconButton } from "@/components/ui/icon-button";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingLayout,
});

function OnboardingLayout() {
  const { signingOut, handleSignOut } = useSignOut();

  return (
    <div className="mila-page flex min-h-screen flex-col">
      <header className="mila-container flex items-center justify-between py-6">
        <Link
          to="/onboarding/style-profile"
          className="font-display text-xl tracking-[0.2em] text-ink"
        >
          MILA
        </Link>
        <IconButton variant="ghost" label="Sign out" onClick={handleSignOut} disabled={signingOut}>
          <LogOut className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      </header>
      <main className="mila-container flex-1 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Onboarding route**

```tsx
// src/routes/_authenticated/onboarding/style-profile.tsx
import { createFileRoute } from "@tanstack/react-router";
import { StyleProfile } from "@/components/style-profile/style-profile-page";

export const Route = createFileRoute("/_authenticated/onboarding/style-profile")({
  component: StyleProfile,
});
```

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

The TanStack Router Vite plugin regenerates `src/routeTree.gen.ts` automatically on `bun run dev`/`build` — do not hand-edit that file.

- [ ] **Step 4: Manual check**

`bun run dev`, navigate directly to `https://localhost:8080/onboarding/style-profile` while signed in — confirm it renders the same dossier/quiz UI under the minimal header (no bottom tab bar, no dashboard/feed/history nav links), and that "Sign out" works.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/onboarding.tsx src/routes/_authenticated/onboarding/style-profile.tsx
git commit -m "$(cat <<'EOF'
feat(onboarding): add minimal-chrome onboarding layout and route

Renders the existing StyleProfile page under a logo+logout-only
header instead of the full AppShell navigation, so onboarding can't
be bypassed via normal nav links. No completeness guard on this route
itself — see Task 4, which guards the member layout instead.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Guard the member (`_app`) layout

**Files:**

- Modify: `src/routes/_authenticated/_app.tsx`

**Interfaces:**

- Consumes: `loadAuthenticatedViewerState` (Task 1), `useRouteContext`/`Route.useRouteContext` pattern already used elsewhere in the repo for `queryClient` access (see `__root.tsx`'s `createRootRouteWithContext<{ queryClient: QueryClient }>()`).

- [ ] **Step 1: Add `beforeLoad`**

```tsx
// src/routes/_authenticated/_app.tsx
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/_app")({
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return; // _authenticated's own guard handles the no-session case
    const viewer = await loadAuthenticatedViewerState(context.queryClient, userId);
    if (viewer.isAdmin) {
      throw redirect({ to: "/admin", replace: true });
    }
    if (!viewer.isStyleProfileComplete) {
      throw redirect({ to: "/onboarding/style-profile", replace: true });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
```

**Note on `context.queryClient`**: confirm the exact context shape by reading `src/routes/__root.tsx`'s `createRootRouteWithContext<{...}>()` call and how `_authenticated.tsx` or `__root.tsx` provides `queryClient` — the repo's root route already types `{ queryClient: QueryClient }` per earlier inspection (`RootComponent` calls `Route.useRouteContext()` to get it), so `beforeLoad`'s `context` parameter should already carry `queryClient` without extra wiring. If `beforeLoad` context doesn't include it for this nested route, add `context: ({ context }) => ({ queryClient: context.queryClient })` up the route chain as needed — check `_authenticated.tsx` first since context flows down through parent `beforeLoad`/`context` functions.

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 3: Manual check — the core routing matrix**

`bun run dev`, using real test accounts (create via sign-up in the running app, or the existing `.env` `ADMIN_EMAIL`/`MODERATOR_EMAIL` bootstrap accounts if already provisioned in the connected Supabase project):

1. Sign in as a non-admin with an incomplete profile → visit `/dashboard` directly → confirm redirect to `/onboarding/style-profile`.
2. Same account → visit `/feed`, `/history`, `/style-profile` directly → confirm each redirects to `/onboarding/style-profile`.
3. Complete the style profile (fill every required field via the quizzes) → re-visit `/dashboard` → confirm it now loads normally.
4. Sign in as an admin account with an incomplete profile (grant admin via the SQL bootstrap step in the README if needed) → visit `/dashboard` → confirm redirect to `/admin`, not onboarding.

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/_app.tsx
git commit -m "$(cat <<'EOF'
feat(auth): guard the member layout with the destination resolver

Admins visiting /dashboard, /feed, /history, or /style-profile are
redirected to /admin; incomplete non-admins are redirected to
/onboarding/style-profile. Covers all four routes in one guard since
they share this layout.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Guard the admin layout

**Files:**

- Modify: `src/routes/_authenticated/admin.tsx`

- [ ] **Step 1: Add `beforeLoad`**

```tsx
// src/routes/_authenticated/admin.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/admin-shell";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    const viewer = await loadAuthenticatedViewerState(context.queryClient, userId);
    if (!viewer.isAdmin) {
      throw redirect({ to: viewer.destination, replace: true });
    }
  },
  component: AdminShell,
});
```

Note: `viewer.destination` for a non-admin is always `/onboarding/style-profile` or `/dashboard` (never `/admin`, since `isAdmin` is false here) — safe to redirect to directly without an extra branch.

`AdminShell`'s existing client-side `adminAmIAdmin()` check and "Restricted" render stay untouched as a defensive fallback (belt-and-suspenders for the brief window before/if the loader result differs from a subsequent client refetch) — do not remove it.

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 3: Manual check**

Sign in as a non-admin (complete or incomplete profile) → visit `/admin`, `/admin/members`, `/admin/moderation`, `/admin/support` directly → confirm each redirects to the correct member destination without ever rendering admin data. Sign in as an admin → visit `/admin` → confirm normal access.

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/admin.tsx
git commit -m "$(cat <<'EOF'
feat(admin): add route-level redirect guard for non-admins

AdminShell's client-side "Restricted" screen previously was the only
enforcement of /admin access at the route level (server functions
already independently verify admin via assertAdmin). This adds an
actual beforeLoad redirect so non-admins never navigate into the
admin route tree in the first place.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Landing, login, and OAuth callback use the shared resolver

**Files:**

- Modify: `src/routes/index.tsx`
- Modify: `src/routes/login.tsx`
- Modify: `src/routes/auth/callback.tsx`

**Interfaces:**

- Consumes: `loadAuthenticatedViewerState` (route loaders), `useAuthenticatedViewerState` (login.tsx's effect-based redirect).

- [ ] **Step 1: `index.tsx`**

Read the current file (`beforeLoad` currently calls `adminAmIAdmin()` directly and redirects to `gate.is_admin ? "/admin" : "/dashboard"`). Replace that branch with:

```tsx
beforeLoad: async ({ context }) => {
  if (typeof window === "undefined") return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const viewer = await loadAuthenticatedViewerState(context.queryClient, data.session.user.id);
  throw redirect({ to: viewer.destination });
},
```

Remove the now-unused `adminAmIAdmin` import if nothing else in the file uses it.

- [ ] **Step 2: `login.tsx`**

Read the current file. Replace the `useQuery({...adminGateQueryOptions(), ...})` + manual `navigate({ to: gate?.is_admin ? "/admin" : "/dashboard" })` effect with `useAuthenticatedViewerState(session?.user.id)`:

```tsx
const { destination, isLoading: viewerLoading } = useAuthenticatedViewerState(session?.user.id);

useEffect(() => {
  if (!loading && session && !viewerLoading) {
    navigate({ to: destination });
  }
}, [loading, session, viewerLoading, destination, navigate]);
```

- [ ] **Step 3: `auth/callback.tsx`**

Read the current file (`sanitizeNext` + unconditional redirect to `search.next`, default `/dashboard`). Replace the `beforeLoad` body:

```tsx
beforeLoad: async ({ search, context }) => {
  if (typeof window === "undefined") return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw redirect({ href: search.next });
    // no session established — fall through to whatever next/login flow already existed
  }
  const viewer = await loadAuthenticatedViewerState(context.queryClient, data.session.user.id);
  // Only honor the caller-supplied `next` when it doesn't override a
  // higher-priority destination (admin, onboarding) — sanitizeNext already
  // guarantees `next` is an internal path, never an external URL.
  const destination = viewer.destination === "/dashboard" ? search.next : viewer.destination;
  throw redirect({ href: destination, replace: true });
},
```

Keep the existing `sanitizeNext` function exactly as-is (already internal-path-only).

- [ ] **Step 4: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 5: Manual check**

Sign out completely, sign back in with an incomplete-profile account via the email/password form → confirm landing on `/onboarding/style-profile`, not `/dashboard`. Repeat with an admin account → confirm landing on `/admin`. If Google OAuth is configured in the connected Supabase project, repeat via `/auth/callback` for at least one case; otherwise note this as unverified in the report (OAuth requires a configured Google provider in Supabase, which may or may not be set up in this environment).

- [ ] **Step 6: Commit**

```bash
git add src/routes/index.tsx src/routes/login.tsx src/routes/auth/callback.tsx
git commit -m "$(cat <<'EOF'
feat(auth): route landing, login, and OAuth callback through the shared resolver

All three previously computed "admin ? /admin : /dashboard" independently
and none of them checked style-profile completion. Now all three call
the same resolveAuthenticatedDestination-backed helper.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Replace dashboard's local completion check; final validation

**Files:**

- Modify: `src/routes/_authenticated/_app/dashboard.tsx`

- [ ] **Step 1: Replace the weak inline check**

Read the current file. Replace:

```ts
const profileComplete = !!(profile?.body_type && profile?.color_season);
```

with the centralized helper. Since `profileQueryOptions` already provides `body_type`/`color_season`/etc. and Task 1 added `color_profile` to its return shape, dashboard can reuse the same query result directly:

```ts
import { isStyleProfileComplete } from "@/lib/style-profile/completion";
// ...
const profileComplete = isStyleProfileComplete(profile ?? null);
```

Read how `profileComplete` is consumed further down in the file before changing its meaning — if it currently only toggles a UI nudge (not a hard gate, since the route guard now handles hard gating), confirm the nudge still makes sense with the stricter check; adjust copy only if the existing nudge text assumes the old weaker definition.

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 3: Full manual routing matrix**

Re-run every case from the design doc's routing matrix end-to-end in the running dev server:

- Signed-out visitor → `/dashboard`, `/admin` → both to `/login`
- Incomplete non-admin → `/`, `/dashboard`, `/feed`, `/history`, `/admin` → all to `/onboarding/style-profile`
- Complete non-admin → `/`, `/admin` → to `/dashboard`; `/onboarding/style-profile` directly → loads (not blocked, not looping)
- Admin (any profile state) → `/`, `/dashboard`, `/onboarding/style-profile`, `/login` (already signed in) → all to `/admin`
- Complete non-admin → `/style-profile` → loads normally under `AppShell`, editing and saving still works, still complete afterward

- [ ] **Step 4: Full validation suite**

```bash
bun run format
bun run lint
bunx tsc --noEmit
bun run build
```

Review `git status` after `format` — if it touched files outside this feature's scope, revert those (same caution as prior passes in this repo).

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/_app/dashboard.tsx
git commit -m "$(cat <<'EOF'
refactor(dashboard): use the centralized style-profile completion check

Replaces the local `!!(body_type && color_season)` check — which
missed skin_undertone, face_shape, hair_type, and color_profile — with
isStyleProfileComplete, the same function every route guard now uses.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
