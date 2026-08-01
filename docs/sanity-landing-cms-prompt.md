# Prompt: move the landing page off hardcoded copy and onto Sanity

Copy everything below the line into a fresh Claude Code session started from `/Users/user/nxt`
(the **parent** folder — not `mila_v1`, so the Studio and the app are both visible).

---

You are wiring Sanity CMS into the Mila marketing landing page. The app is at
`/Users/user/nxt/mila_v1`. The Studio must live at `/Users/user/nxt/studio-mila` — a standalone
sibling folder. **Never** embed the Studio into the app, and never move it inside `mila_v1`.

Read `.agents/skills/sanity-best-practices/references/get-started.md` before you start. Then read
**`remix.md`**, not `nextjs.md` — see "Framework reality check" below. Read `schema.md` when you
write the schema.

## Project facts

| | |
|---|---|
| Sanity project | Mila — `8bkzi9bn` |
| Dataset | `production` |
| Studio path | `/Users/user/nxt/studio-mila` (standalone, create it — it does not exist yet) |
| App path | `/Users/user/nxt/mila_v1` |
| App stack | React 19 · TanStack Start + Router · Vite 7 · Nitro · Tailwind v4 · Bun |
| Package manager | **bun** (`bun add`, `bun run`) — there is a `bun.lock`, no `package-lock.json` |

## Framework reality check — do not skip this

The Sanity onboarding flow labels this project "Next.js". **It is not.** There is no `next`
dependency. `mila_v1/package.json` has `@tanstack/react-start`, `@tanstack/react-router`, `vite`,
and `nitro`. Concretely:

- **Do not install `next-sanity`.** Install `@sanity/client` (and `@sanity/image-url` only if you
  end up serving Sanity-hosted images).
- **Do not** use `NEXT_PUBLIC_*`, `next/image`, `notFound()`, `{ next: { revalidate } }`, or React
  Server Components. None of them exist here.
- Follow the **`remix.md`** reference — it is the Vite-based React guide and its env-var and
  bundling rules apply verbatim. Translate its `loader`/`useLoaderData` examples to TanStack
  Router's `createFileRoute({ loader })` + `Route.useLoaderData()`.
- Env vars follow the repo's existing convention: publishable values get a `VITE_` prefix and are
  read via `import.meta.env`; secrets stay unprefixed and are read via `process.env` **only inside
  server functions**. See `mila_v1/.env.example` for the house style, and add your new keys there
  (with empty values) as well as to `.env`.

### CSP gotcha — read `mila_v1/vite.config.ts`

The production build ships a Content-Security-Policy through Nitro route rules. `connect-src` is an
allowlist and **does not include Sanity**. If you fetch from the browser, production will break
while dev looks fine.

Two options, in order of preference:

1. **Fetch server-side only** (recommended). Wrap the Sanity fetch in
   `createServerFn({ method: "GET" })` from `@tanstack/react-start` and call it from the route
   loader. Nothing Sanity-related reaches the browser, the CSP never applies, and any read token
   stays on the server. This is the answer unless you add Visual Editing later.
2. If you genuinely need browser-side reads, add `https://8bkzi9bn.api.sanity.io` and
   `https://8bkzi9bn.apicdn.sanity.io` to `connect-src` in `buildCsp()`. Do this *deliberately*,
   not as a reflex to a console error.

`img-src` already allows `https:`, so `cdn.sanity.io` images are fine either way.

## What is hardcoded today

The landing page is `mila_v1/src/routes/index.tsx`, which composes nine components from
`src/components/landing/`. Copy lives in two places:

- **`src/constants/landing.ts`** — `TESTIMONIALS` (5 entries: `name`, `season`, `quote`) and
  `STEPS` (3 entries: `n`, `title`, `body`).
- **Inline JSX** in each section component. Every heading, kicker, paragraph, label, and sample
  value is typed directly into the markup.

Full inventory, section by section — this is your migration checklist:

| Component | Content to move |
|---|---|
| `hero-section.tsx` | kicker, headline (renders as two lines via `<br />`), subhead, CTA note ("Takes under a minute"), and the whole preview card: season tag, weather line, outfit title + description, hair note, makeup note |
| `testimonials-section.tsx` | the `TESTIMONIALS` array |
| `how-it-works-section.tsx` | kicker, heading, the `STEPS` array |
| `dossier-section.tsx` | kicker, heading, body, card title, season tag, 3 label/value rows, completion label + percentage (currently `80%`, hardcoded twice — the text *and* the `w-4/5` bar width) |
| `dupe-hunter-section.tsx` | kicker, heading, body, and both comparison cards (label, title, price; the left price is struck through) |
| `community-section.tsx` | kicker, heading, body, the season chip list |
| `final-cta-section.tsx` | heading, body, privacy line |
| `site-footer.tsx` | wordmark, tagline (leave the `© {year}` as computed JS) |
| `site-header.tsx` | **leave alone.** Its labels are auth-state-driven, not marketing copy. |

## Content model

One **singleton** document, `_type: "landingPage"`, `_id: "landingPage"`, pinned in Studio
Structure so editors get a single "Landing page" entry with no list and no create/delete action.

Model it as a fixed set of named object fields — one per section, matching the table above — **not**
as a page-builder array. The section order is fixed in `index.tsx` and nobody has asked to
rearrange it. If reordering or optional sections are ever needed, `page-builder.md` covers the
upgrade; do not pre-build it now.

Rules:

- Use `defineType` / `defineField` throughout. Every field gets an explicit `type`.
- Plain `string` for headings, labels, and short copy. **No Portable Text** — none of this copy has
  rich formatting, and `@portabletext/react` would be a dependency serving zero markup.
- The hero headline breaks across two lines. Model it as two `string` fields (`headlineLine1`,
  `headlineLine2`) rather than smuggling a `\n` through a single string.
- Arrays of objects for `testimonials`, `steps`, `dossierRows`, and `seasonChips`. Give each a
  `preview` so the Studio list is readable, and set `validation: (Rule) => Rule.required().min(1)`
  where the layout assumes non-empty.
- Mark required every field whose absence would render an empty heading or a bare quote mark.
- The dossier completion percentage is a `number` with `Rule.min(0).max(100)`. On the frontend
  drive the bar with an inline `style={{ width: \`${pct}%\` }}`, not a Tailwind fraction class —
  Tailwind cannot generate classes from runtime values.
- Prices in the dupe-hunter section are `string`, not `number`. They carry a currency symbol and
  are pure marketing copy; no arithmetic happens.

## Steps

1. **Verify the layout first.** Confirm both `/Users/user/nxt/studio-mila` (after you create it)
   and `/Users/user/nxt/mila_v1` are visible from your working directory. If you can only see the
   app's source, stop and ask to be restarted from `/Users/user/nxt`.
2. **Create the Studio**, from `/Users/user/nxt`, never from inside `mila_v1`:
   ```bash
   npm create sanity@latest -- --project 8bkzi9bn --dataset production --template clean --typescript --output-path studio-mila
   ```
3. **Write the schema** in `studio-mila/schemaTypes/landingPage.ts`, register it, and add the
   singleton to Studio Structure (`studio-structure.md`).
4. **Deploy the schema** — `npx sanity schemas deploy` from `studio-mila`. Required before any MCP
   content tool can see the new type.
5. **Seed the content** with the *exact* strings currently in the components and
   `src/constants/landing.ts`. This is a lift-and-shift: the rendered page must be byte-identical
   before and after. Do not improve the copy. If you think a line reads badly, say so at the end —
   do not edit it.
6. **Wire the app:**
   - `bun add @sanity/client`
   - `src/lib/sanity/client.ts` — `createClient({ projectId, dataset, apiVersion: "2026-08-01", useCdn: true })`, reading `import.meta.env.VITE_SANITY_*`.
   - `src/lib/sanity/landing.ts` — the GROQ query via `defineQuery`, wrapped in a `createServerFn`.
     Project only the fields the page renders; do not `*[_type == "landingPage"][0]` bare. See
     `groq.md`.
   - `src/routes/index.tsx` — add a `loader` that calls the server function. Leave the existing
     `beforeLoad` redirect and the authenticated-viewer splash untouched; they run before the
     loader matters.
   - Pass the section data down as props. Each section component takes a typed prop instead of
     importing constants.
7. **Delete the old copy.** Remove `src/constants/landing.ts` and every inline string you moved.
   Leaving both is the failure mode — two sources drift and the CMS becomes decorative. Grep for
   `TESTIMONIALS` and `STEPS` afterwards to confirm no importers remain.
8. **Verify:**
   - `bun run typecheck` and `bun run lint` are clean.
   - `bun run dev`, load `/` signed out, and diff against the current page — same copy, same order.
   - Browser console is clean. No `process is not defined`, no CSP violation.
   - `bun run build` succeeds, then `bun run start` and reload `/` to exercise the production CSP.

## Constraints

- **Do not touch anything outside the landing page.** No auth, no Supabase, no Paddle, no
  authenticated routes. The dossier and dupe-hunter *sections* are marketing mockups of real
  features; you are editing the mockup copy, not the features.
- **Do not restyle.** No className changes beyond the one dynamic width mentioned above. The repo
  has a settled `atelier-*` design system (see `docs/component-adoption-prompt.md`) — respect it.
- **Do not add Visual Editing, TypeGen, i18n, or a page builder** in this pass. Each is a separate
  reference in the skill and a separate decision. Mention them at the end if you think they earn
  their keep; do not install them.
- Keep the diff small. A section component should gain a props type and lose its string literals —
  nothing else.

## Report at the end

Line count before and after, the file list, anything in the copy you'd flag, and one sentence on
whether TypeGen is worth adding next.
