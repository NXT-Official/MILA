# Mila — Personal AI Fashion Stylist

Mila is an AI-powered fashion and styling app. It builds a user's 16-season
color profile and silhouette from a portrait, then uses that profile to
generate outfit, hair, and makeup recommendations, analyze wardrobe items,
find product "dupes," and run a styling chat — all rendered through a
server-rendered React app deployed on Cloudflare's edge network with
Supabase as the backend.

Branding and copy live in the document head at
[`src/routes/__root.tsx`](src/routes/__root.tsx#L77-L81).

## Tech stack

### Frontend framework

- **[TanStack Start](https://tanstack.com/start)** (`@tanstack/react-start`) — full-stack
  React framework providing SSR, server functions (`createServerFn`), and
  file-based routing. Entry points: [`src/start.ts`](src/start.ts),
  [`src/router.tsx`](src/router.tsx), [`src/server.ts`](src/server.ts).
- **[TanStack Router](https://tanstack.com/router)** (`@tanstack/react-router`) — type-safe,
  file-based routing. Routes live under [`src/routes/`](src/routes), e.g.
  [`index.tsx`](src/routes/index.tsx), [`login.tsx`](src/routes/login.tsx),
  and the authenticated section
  [`_authenticated/`](src/routes/_authenticated) (dashboard, feed, history,
  style profile, admin). The route tree is generated into
  [`src/routeTree.gen.ts`](src/routeTree.gen.ts) by
  `@tanstack/router-plugin`.
- **[TanStack Query](https://tanstack.com/query)** (`@tanstack/react-query`) — server-state
  caching, wired up via `QueryClientProvider` in
  [`src/routes/__root.tsx`](src/routes/__root.tsx#L1-L120).
- **React 19** (`react`, `react-dom`) — UI runtime.
- **TypeScript 5.8** — strict mode enabled in
  [`tsconfig.json`](tsconfig.json), with the `@/*` path alias mapped to
  `src/*`.

### Build tooling

- **[Vite 7](https://vitejs.dev/)** — dev server and bundler, configured in
  [`vite.config.ts`](vite.config.ts) via the Lovable-managed
  `@lovable.dev/vite-tanstack-config` preset (which internally wires up
  TanStack Start, React, Tailwind, tsconfig-paths, and the Cloudflare
  plugin).
- **[@cloudflare/vite-plugin](https://developers.cloudflare.com/workers/vite-plugin/)** — builds
  the app for Cloudflare Workers.
- **[Bun](https://bun.sh/)** — primary package manager/runtime (see
  [`bun.lock`](bun.lock) and [`bunfig.toml`](bunfig.toml), which enforces a
  24-hour "supply-chain guard" delaying newly published package versions).
  A `package-lock.json` is also present, so `npm` works as a fallback.
- **ESLint 9 (flat config)** + **typescript-eslint** — see
  [`eslint.config.js`](eslint.config.js). Includes a custom rule that bans
  Next.js's `server-only` package in favor of TanStack Start's `*.server.ts`
  convention.
- **Prettier** — formatting, configured in [`.prettierrc`](.prettierrc).

### UI & styling

- **[Tailwind CSS v4](https://tailwindcss.com/)** (`tailwindcss`,
  `@tailwindcss/vite`) — utility-first styling, entry stylesheet at
  [`src/styles.css`](src/styles.css).
- **[shadcn/ui](https://ui.shadcn.com/)** ("new-york" style, Lucide icons) —
  configured in [`components.json`](components.json); generated primitives
  live in [`src/components/ui/`](src/components/ui).
- **[Radix UI](https://www.radix-ui.com/)** primitives (accordion, dialog,
  dropdown-menu, popover, select, tabs, tooltip, etc.) underlying the
  shadcn components — see the `@radix-ui/*` entries in
  [`package.json`](package.json#L18-L43).
- **[Framer Motion](https://www.framer.com/motion/)** — animation.
- **[Lucide React](https://lucide.dev/)** — icon set.
- **[class-variance-authority](https://cva.style/)**, **clsx**,
  **tailwind-merge** — className composition, unified in
  [`src/lib/utils.ts`](src/lib/utils.ts).
- **[Sonner](https://sonner.emilkowal.ski/)** — toast notifications,
  mounted in [`src/routes/__root.tsx`](src/routes/__root.tsx#L123).
- **[Vaul](https://vaul.emilkowal.ski/)** — drawer component; **cmdk** —
  command palette; **embla-carousel-react** — carousels; **recharts** —
  charts; **react-day-picker** — date picking; **input-otp** — OTP input;
  **react-resizable-panels** — resizable panel layouts.
- Fonts: **Playfair Display** (headlines) + **Inter** (body), loaded from
  Google Fonts in
  [`src/routes/__root.tsx`](src/routes/__root.tsx#L91-L93).

### Forms & validation

- **[React Hook Form](https://react-hook-form.com/)** + **@hookform/resolvers**
  for form state/validation, e.g.
  [`src/components/studio/holistic-profile-form.tsx`](src/components/studio/holistic-profile-form.tsx).
- **[Zod](https://zod.dev/)** — schema validation, used both client-side and
  as the input schema for every server function (e.g. the `Input` schema in
  [`src/lib/generate-outfit.functions.ts`](src/lib/generate-outfit.functions.ts#L6-L23)).

### Backend / data

- **[Supabase](https://supabase.com/)** — Postgres database, auth, and
  row-level security, provisioned as **Lovable Cloud**
  (project ref `aezfcwkvszgstjgoficb`, see
  [`supabase/config.toml`](supabase/config.toml) and
  [`.env`](.env)).
  - Client SDK: `@supabase/supabase-js`, browser client in
    [`src/integrations/supabase/client.ts`](src/integrations/supabase/client.ts),
    server client in
    [`src/integrations/supabase/client.server.ts`](src/integrations/supabase/client.server.ts).
  - Generated DB types: [`src/integrations/supabase/types.ts`](src/integrations/supabase/types.ts).
  - Auth middleware verifying bearer JWTs on every protected server
    function: [`src/integrations/supabase/auth-middleware.ts`](src/integrations/supabase/auth-middleware.ts).
  - SQL migrations (schema history) in
    [`supabase/migrations/`](supabase/migrations), defining tables such as
    `profiles`, `outfits`, `clothes`, `user_entitlements`, `purchases`,
    `ad_events`, `brands`, `products`, `user_favorites`, `posts`, and
    `user_roles`.
- **TanStack Start server functions** (`createServerFn`) — the app's API
  layer; each feature has a dedicated `*.functions.ts` module under
  [`src/lib/`](src/lib):
  - [`generate-outfit.functions.ts`](src/lib/generate-outfit.functions.ts) — daily look generation (outfit + hair + makeup), also calls the Open-Meteo weather API.
  - [`analyze-clothing.functions.ts`](src/lib/analyze-clothing.functions.ts) — wardrobe item analysis from photos.
  - [`analyze-outfit.functions.ts`](src/lib/analyze-outfit.functions.ts) — outfit critique/analysis.
  - [`analyzePersonalColor.functions.ts`](src/lib/analyzePersonalColor.functions.ts) — portrait-based 16-season color/vision analysis.
  - [`dupe-hunter.functions.ts`](src/lib/dupe-hunter.functions.ts) — finds cheaper product "dupes."
  - [`fix-outfit-chat.functions.ts`](src/lib/fix-outfit-chat.functions.ts) — conversational outfit-fixing chat.
  - [`posts.functions.ts`](src/lib/posts.functions.ts), [`profile.functions.ts`](src/lib/profile.functions.ts), [`admin.functions.ts`](src/lib/admin.functions.ts) — feed posts, user profile, admin operations.
  - [`credits.server.ts`](src/lib/credits.server.ts) / [`credits.ts`](src/lib/credits.ts) — AI-credit metering (`consumeAiCredit`) shared by the AI features above.

### AI / ML

- **[Lovable AI Gateway](https://docs.lovable.dev/)**
  (`https://ai.gateway.lovable.dev/v1/chat/completions`) — OpenAI-compatible
  chat-completions proxy, authenticated with `process.env.LOVABLE_API_KEY`.
  Used directly via `fetch` (no SDK) in
  [`generate-outfit.functions.ts`](src/lib/generate-outfit.functions.ts#L109-L230),
  [`analyze-clothing.functions.ts`](src/lib/analyze-clothing.functions.ts#L64-L76),
  [`dupe-hunter.functions.ts`](src/lib/dupe-hunter.functions.ts#L118-L131),
  and [`analyzePersonalColor.functions.ts`](src/lib/analyzePersonalColor.functions.ts#L834).
- **Model:** `google/gemini-2.5-flash`, invoked with OpenAI-style
  `tools`/`function` calling (see the `report_daily_look` tool definition in
  [`generate-outfit.functions.ts`](src/lib/generate-outfit.functions.ts#L25-L80)
  and `report_studio_color_profile` in
  [`analyzePersonalColor.functions.ts`](src/lib/analyzePersonalColor.functions.ts)).
  Multimodal image input is sent as a base64 `image_url` for portrait/vision
  analysis
  ([`analyzePersonalColor.functions.ts`](src/lib/analyzePersonalColor.functions.ts#L842-L843)).
- **Deterministic color engine** — the model only returns a raw "vision
  read"; season palettes, hex codes, and styling copy are hydrated from a
  static, hand-authored dictionary
  ([`src/lib/color-analysis/seasonsData.ts`](src/lib/color-analysis/seasonsData.ts),
  [`paletteGenerator.ts`](src/lib/color-analysis/paletteGenerator.ts),
  [`schemaMigration.ts`](src/lib/color-analysis/schemaMigration.ts)) rather
  than generated freeform by the LLM — see the comment at
  [`analyzePersonalColor.functions.ts:65`](src/lib/analyzePersonalColor.functions.ts#L65).

### Auth

- **Supabase Auth** — JWT-based session/user auth, `getClaims` verification
  in [`auth-middleware.ts`](src/integrations/supabase/auth-middleware.ts).
- **[@lovable.dev/cloud-auth-js](https://docs.lovable.dev/)** — OAuth
  wrapper (Google / Apple / Microsoft / Lovable) that mints a Supabase
  session, in the auto-generated
  [`src/integrations/lovable/index.ts`](src/integrations/lovable/index.ts).
- Client-side auth state/context: [`src/hooks/use-auth.tsx`](src/hooks/use-auth.tsx);
  role checks: [`src/hooks/use-is-admin.tsx`](src/hooks/use-is-admin.tsx).
- Route-level gating for the authenticated section:
  [`src/routes/_authenticated.tsx`](src/routes/_authenticated.tsx).

### Deployment / infrastructure

- **[Cloudflare Workers](https://workers.cloudflare.com/)** — production
  runtime, configured in [`wrangler.jsonc`](wrangler.jsonc) (Node.js
  compatibility mode enabled, entry `src/server.ts`).
- [`src/server.ts`](src/server.ts) wraps the generated TanStack Start
  server entry in a Worker `fetch` handler with custom SSR error handling
  (detects h3's swallowed 500s and serves a branded error page via
  [`src/lib/error-page.ts`](src/lib/error-page.ts) /
  [`error-capture.ts`](src/lib/error-capture.ts)).
- **[Lovable](https://lovable.dev/)** — the app was scaffolded and is
  managed via Lovable's `tanstack_start_ts` template (see
  [`.lovable/project.json`](.lovable/project.json)); Lovable also
  provisions the Supabase project ("Lovable Cloud") and the AI Gateway.

### Monetization

- Ads + entitlements scaffolding in
  [`src/lib/monetization.ts`](src/lib/monetization.ts) (`remove_ads`
  product) and the `user_entitlements` / `purchases` / `ad_events` tables —
  currently short-circuited to always grant premium access for
  demo/preview purposes (see the `TODO` at
  [`monetization.ts:32`](src/lib/monetization.ts#L32)).

## Project structure

```
src/
├── components/
│   ├── studio/        # style-profile & holistic-profile forms
│   ├── wardrobe/       # wardrobe UI
│   └── ui/             # shadcn/ui primitives
├── hooks/               # use-auth, use-is-admin, use-mobile
├── integrations/
│   ├── lovable/         # Lovable OAuth wrapper
│   └── supabase/        # Supabase client(s), auth middleware, DB types
├── lib/
│   ├── *.functions.ts   # TanStack Start server functions (the API layer)
│   ├── color-analysis/  # deterministic 16-season color engine
│   └── prompts/         # LLM prompt templates
├── routes/               # file-based routes (TanStack Router)
├── router.tsx, server.ts, start.ts  # app/runtime entry points
└── styles.css            # Tailwind entry point

supabase/
├── config.toml           # Supabase project ref
└── migrations/           # SQL schema history
```

## Getting started

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js 18+/npm
- A Supabase project (or use the credentials already in `.env` for this
  project's Lovable Cloud instance)
- A `LOVABLE_API_KEY` environment variable for AI features (outfit
  generation, clothing analysis, color analysis, dupe hunting, chat)

### Install

```bash
bun install
# or: npm install
```

### Run the dev server

```bash
bun run dev
# or: npm run dev
```

This runs `vite dev` (see the `scripts` block in
[`package.json`](package.json#L6-L13)) and prints a local URL (default
`http://localhost:3000`, actual port shown in the terminal).

### Other scripts

| Command              | Description                                  |
| --------------------- | --------------------------------------------- |
| `bun run build`       | Production build (`vite build`)               |
| `bun run build:dev`   | Development-mode build                        |
| `bun run preview`     | Preview the production build                  |
| `bun run lint`        | Run ESLint                                    |
| `bun run format`      | Format with Prettier                          |

## Environment variables

Defined in [`.env`](.env) (Supabase) — add `LOVABLE_API_KEY` yourself to
enable the AI features:

| Variable                        | Purpose                                   |
| -------------------------------- | ------------------------------------------ |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Supabase project URL                  |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key |
| `SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PROJECT_ID` | Supabase project ref     |
| `LOVABLE_API_KEY`                | Auth for the Lovable AI Gateway (Gemini)  |
