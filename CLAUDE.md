# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Mila is an AI-assisted personal styling web app (TanStack Start, React 19, Supabase). It builds a
member's colour-season/body-silhouette profile from a portrait, then generates daily outfit/hair/makeup
recommendations using that profile plus live weather and an occasion vibe. See `README.md` for full
product, route, schema, and environment-variable documentation — it is kept accurate and detailed;
don't duplicate it here.

## Commands

Package manager and test runner is **Bun**, not npm/yarn/node.

```bash
bun install               # install deps
bun run dev                # HTTPS dev server on :8080 (mkcert cert auto-generated)
bun run build               # Vite client build + Nitro server bundle -> .output/
bun run start                # run the built server: bun .output/server/index.mjs
bun run lint                  # ESLint (flat config)
bun run format                 # Prettier --write
bun run typecheck                # tsc --noEmit
bun test                          # run all tests
bun test src/lib/credits.test.ts   # run a single test file
bun test -t "name"                  # filter by test name
bun run test:watch
bun run test:coverage
```

CI (`.github/workflows/ci.yml`) runs, in order: `lint` → `typecheck` → `bun test` → `bun audit --prod`
→ `build`. Run the same sequence locally before opening a PR.

Tests are colocated as `*.test.ts` next to the code they cover (not in a separate test tree), except
shared fakes in `tests/helpers/`. External Supabase/hCaptcha calls are mocked — no network or real
credentials needed to run the suite.

## Architecture

### Two parallel server surfaces — keep them in sync

There are **two separate ways a client calls privileged/server logic**, and they must stay behaviorally
identical because a second app depends on the second one:

1. **Website surface** — `src/lib/*.functions.ts` uses TanStack Start's `createServerFn`, called
   directly from React components/hooks via TanStack Query. Auth is enforced by the
   `requireSupabaseAuth` middleware (`src/integrations/supabase/auth-middleware.ts`).
2. **Mobile REST surface** — `src/routes/api/v1/**` file routes (`POST /api/v1/...`) are the door for
   a separate native app (`MILA_MOBILE`, not in this repo). Each route is a thin adapter: it calls
   `requireActiveMember`/`requireAuthenticatedUser` (`src/server/api/auth.ts`) for bearer-token auth,
   then delegates to a shared service in `src/server/services/*.ts`, and translates errors to the
   typed `ApiError` contract in `src/server/api/respond.ts` (`{ error: { code, message, retryAfter? } }`,
   bare payload on success — this shape is dictated by the mobile client's existing typed caller, not
   invented here; don't wrap success in `{ data: ... }`).

When a feature needs new server logic that both surfaces should expose, put the actual logic in
`src/server/services/`, and have both the `*.functions.ts` server function and the `/api/v1` route call
it — don't fork the logic. When only the website needs something, a `*.functions.ts` file alone is fine.

### Server-only code convention

Files that must never reach the browser bundle end in `*.server.ts` (e.g. `client.server.ts`,
`ai.server.ts`). ESLint blocks importing the `server-only` npm package specifically because this repo
uses the filename convention (or `@tanstack/react-start/server-only`) instead — see
`eslint.config.js`'s `no-restricted-imports` rule. The Supabase service-role client is additionally
imported _lazily_ inside functions that need it (`await import("@/integrations/supabase/client.server")`)
so it can never end up in a client chunk even transitively.

### Three Supabase clients — pick the right one

- `src/integrations/supabase/client.ts` — browser client, anon/publishable key, RLS applies.
- `src/integrations/supabase/client.server.ts` — service-role client, **bypasses RLS**, server-only,
  lazy-imported. Use only where the audit already says a privileged read/write is required.
- `src/integrations/supabase/auth-middleware.ts` — request-scoped client authenticated as the
  _caller_ (used by both server surfaces above) so RLS applies exactly as it would in the browser.
  Prefer this over the service-role client whenever the operation doesn't need to bypass RLS.

### Auth gating layers

- `src/routes/_authenticated.tsx` — client-side "is there a session" redirect to `/login` (skipped
  during SSR; not a real security boundary by itself).
- `src/routes/_authenticated/_app.tsx` — adds the "style profile complete" redirect to
  `/onboarding/style-profile`.
- Every server function / `/api/v1` route re-verifies the JWT and `profiles.suspended` server-side
  regardless of client-side gating — that's the actual trust boundary.
- This app has **no role/staff logic at all** (see Staff suite below) — don't add role checks here.

### Routing

TanStack Router is file-based under `src/routes/`; the tree is generated into
`src/routeTree.gen.ts` — never hand-edit that file. `_`-prefixed segments (`_authenticated`,
`_authenticated/_app`) are pathless layout routes.

### Data flow

Component/route → `queryOptions()` factory in `src/lib/queries/*.ts` (wraps a direct Supabase call or
a server function) → TanStack Query cache, keyed via `src/constants/query-keys.ts`. Mutations call the
server function/service directly, then `queryClient.invalidateQueries` on success, and surface errors
via Sonner (`toast.error`). Zod schemas are typically re-validated server-side with `.validator()` —
client validation is UX only, not the trust boundary.

### Staff suite is a separate repo

Admin/moderator UI lives in a sibling repo (`../../MILA_ADMIN`), sharing this Supabase project. This
repo owns `supabase/migrations/` as the schema source of truth, **including staff-only tables/RPCs**
(`user_roles`, `has_role`, `manage_user_role`, `set_user_suspended`). After changing a migration,
regenerate `src/integrations/supabase/types.ts` in **both** repos — it's duplicated, not shared. Never
add role checks, staff server functions, or a link/redirect toward the staff origin in this app — that
separation is deliberate.

### Design system

Tokens are CSS-first in `src/styles.css` via Tailwind v4 `@theme` (`canvas`, `surface`, `ink`, `muted`,
`accent`/`accent-soft`, `line`, `success`/`warning`/`destructive`), with `.dark` overrides. Shared
primitives live in `src/components/ui/` (Radix UI underneath); use `cn()` (`src/lib/utils.ts`) for
conditional classes and `class-variance-authority` for real variants — don't hand-roll either. Icons are
Lucide, imported by name only.

### Path alias

`@/*` → `./src/*` (see `tsconfig.json`). Use it instead of relative `../../..` imports.
