# Post-Auth Routing and Style-Profile Onboarding — Design

## Context

Today, destination logic after sign-in is duplicated and incomplete:

- `login.tsx` navigates based only on `adminGateQueryOptions()` (`gate.is_admin ? "/admin" : "/dashboard"`) — no style-profile check at all.
- `index.tsx` (landing) does the same admin-only check in `beforeLoad`, calling `adminAmIAdmin()` directly.
- `auth/callback.tsx` ignores role/profile entirely and redirects to `next` (default `/dashboard`).
- `dashboard.tsx` computes its own partial, weaker completion check inline: `!!(profile?.body_type && profile?.color_season)` — missing `skin_undertone`, `face_shape`, `hair_type`, `color_profile`.
- Nothing prevents a signed-in non-admin from opening `/dashboard`, `/feed`, `/history`, or `/style-profile` directly with zero style-profile data.
- `/admin` has no route-level guard; `AdminShell` shows a client-only "Restricted" screen for non-admins, but the route itself never redirects.

`/style-profile` (`src/routes/_authenticated/_app/style-profile.tsx`, 965 lines) is not a step-sequenced wizard — it's a single "Studio Portfolio" page that shows a dossier plus quiz overlays (`ColorQuiz`, `BodyTypeQuiz`, `VisualDiagnosticViewfinder`) a user can fill in any order, with local component state hydrated directly from Supabase (not through `profileQueryOptions`/`profile.functions.ts`). Building a second, separate step-by-step onboarding UI would duplicate this entire page.

## Decision: reuse, don't rebuild

`/onboarding/style-profile` renders the _same_ `StyleProfile` component as `/style-profile`, extracted into its own module and imported by both route files. The only difference between the two routes is layout chrome (minimal logo+logout for onboarding vs. full `AppShell` for the manage view) and guard position (onboarding sits outside the completeness guard; manage sits inside it). This satisfies "reuse existing forms, don't build a second unrelated implementation" and avoids re-implementing quiz-step sequencing that doesn't exist today.

Consequence: there is no discrete "step N of 7" onboarding wizard, because the underlying page isn't structured that way. The existing page already lets a returning incomplete user "resume" naturally — whatever's unfilled just still shows as unfilled when they reopen it. A literal step-by-step progress indicator is out of scope for this pass; noted as a possible follow-up, not implemented here.

## Completion contract

`isStyleProfileComplete(profile)` — new pure function, single source of truth. Input matches the raw `profiles` row shape (as returned by `getMyProfile`/`profileQueryOptions`'s underlying query, not any derived display shape).

Required (validated against the exact allow-lists already used by the app, `src/constants/style-profile/data.ts`):

- `skin_undertone` ∈ `UNDERTONES` (`Cool`/`Warm`/`Neutral`)
- `color_season` ∈ `SEASONS` (base `Spring`/`Summer`/`Autumn`/`Winter` — matches the DB `CHECK` constraint)
- `body_type` ∈ `BODIES`
- `face_shape` ∈ `FACE_SHAPES`
- `hair_type` ∈ `HAIR_TYPES`
- `color_profile` is a non-null object with at least one recognizable key (`season` or `primarySwatches`) — i.e. not `{}`, not `null`

Not required, with reasoning:

- `beauty_preferences` — DB default is `'[]'::jsonb`; an empty array is a legitimate "no preference" choice, not an incomplete state. Requiring ≥1 would create exactly the onboarding loop the task warns against.
- `default_location` — `src/lib/default-hub.ts` already falls back to a `localStorage` cache or a default hub when unset; it's explicitly optional/inferrable.
- `full_name`, `username` — account-identity fields, not style-dossier fields. Already collected at signup (username) or optional.

## Central resolver

```ts
export type AuthenticatedViewerState = {
  userId: string;
  isAdmin: boolean;
  isStyleProfileComplete: boolean;
  destination: "/admin" | "/onboarding/style-profile" | "/dashboard";
};
```

- `resolveAuthenticatedDestination({ isAdmin, isStyleProfileComplete }): Destination` — pure, synchronous. Admin check strictly before completeness check, per the required priority.
- `loadAuthenticatedViewerState(queryClient, userId): Promise<AuthenticatedViewerState>` — route-loader-friendly; calls `queryClient.ensureQueryData` on the _existing_ `adminGateQueryOptions()` and `profileQueryOptions(userId)`, runs `isStyleProfileComplete`, then `resolveAuthenticatedDestination`. No new server function, no new network round-trip beyond what already exists — this composes two already-cached queries.
- `useAuthenticatedViewerState()` — thin React hook wrapping the same two queries via `useQuery`, for component-level use (e.g. dashboard could show a "complete your profile" nudge without a hard redirect, or `login.tsx`'s post-login effect).

Suspension is deliberately **not** part of this resolver's output. `_authenticated.tsx` already checks `profiles.suspended` and renders a full-screen suspended notice for _any_ nested route, regardless of destination — so whichever destination the resolver picks, a suspended user still gets intercepted by the existing, unmodified suspension gate before any of `/admin`, `/dashboard`, or `/onboarding` render. Duplicating that check into the resolver would be redundant, not defense-in-depth (same client, same request path, same trust level).

## Route changes

- **Extract**: `StyleProfile` component moves from `_app/style-profile.tsx` into `src/components/style-profile/style-profile-page.tsx` (named export), unchanged internals — pure move, not a rewrite.
- **New**: `src/routes/_authenticated/onboarding.tsx` — pathless layout, minimal shell (Mila logo, sign-out button), no `AppShell`/bottom-nav/top-nav. Sits directly under `_authenticated`, sibling to `_app` and `admin`, so it is _not_ subject to the `_app` completeness guard.
- **New**: `src/routes/_authenticated/onboarding/style-profile.tsx` — renders the extracted `StyleProfile` component under the onboarding layout.
- **Modify**: `_app/style-profile.tsx` becomes a thin wrapper importing the same extracted component (keeps the `/style-profile` URL and `AppShell` chrome for the manage/edit experience).
- **Modify**: `_authenticated/_app.tsx` — add `beforeLoad` using `loadAuthenticatedViewerState`: `isAdmin` → redirect `/admin`; `!isStyleProfileComplete` → redirect `/onboarding/style-profile` (both `replace: true`). This single guard covers `/dashboard`, `/feed`, `/history`, and `/style-profile` (manage) since they all nest under `_app`.
- **Modify**: `_authenticated/admin.tsx` — add `beforeLoad` redirecting non-admins to their resolved member destination (`/onboarding/style-profile` or `/dashboard`), `replace: true`. `AdminShell`'s existing client-side "Restricted" render stays as a defensive fallback for the brief window before the loader resolves, but is no longer the only enforcement.
- **Modify**: `index.tsx` — `beforeLoad` uses `loadAuthenticatedViewerState` instead of only `adminAmIAdmin()`, so a signed-in incomplete user lands on `/onboarding/style-profile` directly instead of bouncing through `/dashboard` first.
- **Modify**: `login.tsx` — the post-session `useEffect` navigates via `resolveAuthenticatedDestination` (fed by the same two queries it already partially uses) instead of the current `gate?.is_admin ? "/admin" : "/dashboard"` ternary.
- **Modify**: `auth/callback.tsx` — `beforeLoad` resolves the destination the same way; the existing `sanitizeNext` internal-only redirect value is honored **only** when the resolved destination is `/dashboard` (i.e., never overrides an admin or onboarding redirect) and only for members-area paths.

No changes to `_authenticated.tsx` itself (session + suspension gate already correct and untouched), no changes to `admin.functions.ts`/`has_role`/RLS (server authorization boundary untouched), no changes to the profile DB schema.

## Redirect-loop prevention

- `/onboarding/style-profile` is a sibling of `_app`, not nested inside it — the completeness guard that would send an incomplete user _to_ onboarding never runs _for_ onboarding itself.
- `/admin`'s guard and `_app`'s guard are on disjoint route subtrees; an admin visiting a member route is bounced once (`_app` guard) to `/admin`, which has no further redirect for an admin. A non-admin visiting `/admin` is bounced once to their member destination, which is never `/admin` again.
- All corrective redirects use `replace: true` (no extra history entries, no back-button loop).

## Data writes stay within existing constraints

The extracted `StyleProfile` component already writes through `supabase.from("profiles").update(...)` with an explicit column list (not a spread of the whole form state) and already excludes `suspended`/roles/`created_at`. No change needed there; verified during extraction, not rewritten.

## Out of scope for this pass

- A literal multi-step wizard with a numbered progress indicator (the underlying page isn't step-sequenced; see "Decision" above).
- A `style_profile_completed_at` migration — derived completion only, per the task's explicit preference.
- Server-function-level `STYLE_PROFILE_INCOMPLETE` guards on `generate-outfit.functions.ts` etc. — flagged as a real gap (a signed-in user could still call these server functions directly with an incomplete profile) but implementing it touches multiple existing AI server functions' request/response contracts; treated as a follow-up unless the routing/onboarding work leaves time.
