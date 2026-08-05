# Prompt: consolidate Mila's Tailwind styling into one reusable layer

Copy everything below the line into a fresh Claude Code session in this repo.

---

You are refactoring styling in `/Users/user/nxt/MILA/app` (React + TanStack Router + **Tailwind v4** + shadcn-style primitives in `src/components/ui/`). Global design tokens and component classes live in `src/styles.css` (`@theme inline` for tokens, `@layer components` for classes). `cn()` from `@/lib/utils` merges classes via tailwind-merge.

## Goal

One visual decision = one place in code. Today the same visual idea is retyped as a raw Tailwind string in dozens of files, so changing a border color or a label's letter-spacing means editing 40 files. Collapse the repeated strings into design tokens, `@utility` classes, and variants on the primitives that already exist — **without redesigning anything**. The site must look identical when you're done.

## Ground truth (measured, don't re-derive — verify by spot check)

112 files use `className`. The duplication is concentrated in five areas:

**1. Micro-labels — the worst offender (~250 occurrences).** The uppercase-tiny-wide-tracking label is the signature of this design and it exists in ~40 variants:

- `text-[10px]` ×148, `text-[9px]` ×55, `text-[11px]` ×50, plus `text-[8px]`, `text-[12px]`, `text-[13px]`
- 19 distinct arbitrary trackings: `tracking-[0.2em]` ×49, `[0.22em]` ×38, `[0.32em]` ×36, `[0.18em]` ×33, `[0.25em]` ×26, `[0.28em]` ×16, `[0.42em]` ×13, `[0.3em]` ×9, then a long tail of one-and-two-use values (`[0.12em]`, `[0.14em]`, `[0.15em]`, `[0.16em]`, `[0.24em]`, `[0.26em]`, `[0.34em]`, `[0.35em]`, `[0.38em]`, `[0.4em]`, `[0.5em]`)
- Exact repeated strings: `text-[10px] uppercase tracking-[0.25em] text-stone` ×9, `text-xs uppercase font-medium tracking-widest` ×10, `text-[10px] uppercase tracking-[0.42em] text-muted-foreground` ×4
- Only one utility exists for this today: `.atelier-kicker` (23 uses)

**2. Buttons.** `src/components/ui/button.tsx` has a solid `cva` with variants `primary|secondary|outline|ghost|editorial|destructive` and sizes `sm|md|lg|icon` — but the design's _actual_ button is a pill with uppercase micro-tracking, which is not a variant. So callers override it by hand: `className="rounded-full h-10 px-5 uppercase tracking-[0.2em] text-[11px]"` appears 5× (`routes/_authenticated/_app/dashboard.tsx:348,368,384,399`, `routes/_authenticated/_app/history.tsx:375,387`). Separately there are **113 raw `<button>` elements** across the app; many are pill-shaped chips duplicating `inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-porcelain/60 bg-background/60 backdrop-blur text-[10px] uppercase tracking-[0.22em] text-ink hover:border-porcelain transition-colors` (`components/layout/app-shell.tsx:143,154`).

**3. Surfaces.** Four competing recipes for "a bordered panel":

- `.atelier-card` / `.atelier-hairline-card` (defined in styles.css, 16 uses) = `rounded-card border border-line bg-surface shadow-paper`
- the same thing typed raw: `rounded-card border border-border bg-card p-6 shadow-paper` ×3, `bg-card p-6 rounded-card border border-border shadow-paper space-y-6` ×3
- glass: `rounded-3xl border border-porcelain/60 bg-background/70 backdrop-blur-xl shadow-atelier-soft` (`components/feed/post-canvas.tsx:12`), and near-misses at `feed.tsx:104`, `studio-camera-drawer.tsx:338`, `app-shell.tsx:122`, `admin-header.tsx:33`, `concierge-chat.tsx:384` — differing only in `/60` vs `/70` vs `/80` and `backdrop-blur` vs `-xl`
- `rounded-panel border border-porcelain/60 bg-atelier-panel/40 overflow-hidden` ×3

**4. Token drift.** `border-porcelain` is used at 5 different opacities (`/60` ×37, `/70` ×13, `/30` ×13, `/40` ×9, `/50` ×5) with no rule. Radius mixes semantic tokens with the raw scale: `rounded-card` ×31, `rounded-2xl` ×24, `rounded-xl` ×22, `rounded-panel` ×13, `rounded-3xl` ×6. `backdrop-blur` ×19 vs `-xl` ×12 vs `-md` ×4 vs `-sm` ×4.

**5. Two naming systems.** `styles.css` `@layer components` defines both `mila-*` (`mila-page`, `mila-container`, `mila-panel`, `mila-focus-ring`, `mila-dark-glass`) and `atelier-*` (`atelier-page`, `atelier-card`, `atelier-hairline-card`, `atelier-hero-card`, `atelier-kicker`, `atelier-title`). Usage is lopsided — `mila-page` ×2, `mila-container` ×3, `mila-panel` ×2 vs `atelier-page` ×6, `atelier-card` ×16. Pick one prefix.

Smaller exact duplicates worth folding in:

- avatar disc: `size-{9,10} rounded-full border border-porcelain/60 bg-linear-to-br from-atelier-champagne/30 to-porcelain/20 flex items-center justify-center font-serif text-sm text-ink` (`app-shell.tsx:162`, `post-canvas.tsx:15`)
- media frame: `relative mx-auto aspect-square w-full max-w-lg overflow-hidden rounded-card border border-border bg-card shadow-paper` ×4 (`dashboard/outfit-visual.tsx:22,37,48`, `dashboard/outfit-result-skeleton.tsx:36`) — plus a `max-w-128` variant of the same thing in `routes/_authenticated/_app/history.tsx`
- `font-serif text-2xl tracking-tight leading-snug` ×5
- `border-[0.5px] border-border p-5 text-left rounded-none transition-all hover:border-foreground/40` ×4
- `w-full flex items-center justify-between px-5 py-4 hover:bg-porcelain/20 transition-colors` ×3

## Rules

1. **No new dependencies.** Tailwind v4 + `cva` + `cn()` are already here; that is the whole toolkit.
2. **Zero visual change.** This is a mechanical consolidation. If snapping a value to a token would shift pixels, snap it anyway _only_ when the delta is ≤1 step (e.g. `tracking-[0.24em]` → the `0.25em` token) and list every such rounding in your final report. Never change colors, spacing, or layout to "improve" them.
3. **Prefer extending what exists over creating new things.** `Button`'s `cva` gets a `pill` variant, not a new `PillButton` component. `.atelier-card` already exists — replace the raw copies with it rather than inventing `.surface-card`.
4. **CSS utility vs React component:** if it's pure styling with no behavior, make it a Tailwind v4 `@utility` in `styles.css`. Only make a React component when there is markup structure or behavior to share (avatar disc = component, micro-label = utility).
5. **Don't build a token for a one-off.** A class string that appears once stays inline. Threshold: **3+ occurrences, or 2 occurrences in different feature areas**.
6. **Don't touch** `src/components/ui/*` internals beyond adding variants — those are shadcn primitives and stay upgradable.
7. Keep every `aria-*`, `disabled`, focus-visible ring, and `prefers-reduced-motion` behavior exactly as-is. `mila-focus-ring` (24 uses) must survive.

## Work

**Phase 1 — tokens.** In `src/styles.css` `@theme inline`, add the letter-spacing scale that the arbitrary values are groping toward, e.g. `--tracking-label: 0.2em; --tracking-label-wide: 0.25em; --tracking-label-xwide: 0.32em; --tracking-label-max: 0.42em`, and micro font sizes `--text-micro: 0.625rem /* 10px */; --text-nano: 0.5625rem /* 9px */; --text-label: 0.6875rem /* 11px */`. Map every existing arbitrary value to its nearest token and write the mapping table into the final report before editing anything.

**Phase 2 — utilities.** Add Tailwind v4 `@utility` rules to `styles.css` for the recurring recipes. Suggested set (adjust to what the data actually supports):

- `label` / `label-wide` / `label-xwide` — the uppercase micro-label at each tracking step; `.atelier-kicker` should be re-expressed on top of these, not duplicated
- `surface-glass` — the blurred translucent panel, one canonical opacity
- `media-frame` — the aspect-square bordered image frame
- `row-action` — the full-width `justify-between` hover row
  Standardize `border-porcelain/*` to at most **two** opacities (a strong and a hairline) and note which uses you moved.

**Phase 3 — primitives.** Add to `button.tsx`'s `cva`: a `pill` variant (or `shape: "pill"`) carrying `rounded-full uppercase tracking-label` and an `xs`/`chip` size for the `h-9 px-3 text-[10px]` chip. Replace the 6 hand-overridden `<Button className="rounded-full h-10 px-5 …">` call sites. Then sweep the 113 raw `<button>` elements: convert the ones that are visually buttons/chips to `<Button>`; leave genuinely structural ones (card-sized click targets like `HistoryCard`, icon toggles already covered by `icon-button.tsx`) as raw elements but give them the shared utility class.

**Phase 4 — components.** Extract only where markup repeats: `<Avatar>` (initial disc, `size` prop) used by `app-shell.tsx` and `post-canvas.tsx`. Check `components/ui/empty-state.tsx`, `error-state.tsx`, `loading-state.tsx` first — the "no outfits yet" / "couldn't load" blocks in `routes/_authenticated/_app/history.tsx` and elsewhere look like they're hand-rolling what those already do; if so, delete the hand-rolled copies.

**Phase 5 — naming.** Collapse `mila-*` and `atelier-*` to one prefix. `atelier-*` has more usage; the cheaper migration is to rename the 5 low-use `mila-*` classes. Do it in one pass, no aliases left behind.

## Order and safety

Work phase by phase, and after each phase run:

```bash
npx tsc --noEmit && bun test && bunx eslint src --max-warnings=0
```

Commit each phase separately so any visual regression is bisectable. Do not proceed to the next phase with a red check.

## Acceptance

When done, these greps should return dramatically fewer hits — report before/after counts for each:

```bash
grep -rho "tracking-\[0\.[0-9]*em\]" src | sort | uniq -c | sort -rn   # 19 distinct values → ≤4
grep -rho "text-\[[0-9]*px\]" src | sort | uniq -c | sort -rn          # 253 hits → near zero
grep -rho "border-porcelain/[0-9]*" src | sort | uniq -c               # 5 opacities → ≤2
grep -rn "rounded-full h-10 px-5 uppercase" src                        # → 0
grep -rc "<button" src | grep -v ":0"                                   # 113 → materially lower
```

Finish with a report containing: the token mapping table, every value you rounded, before/after counts for the greps above, files touched, and anything you deliberately left inline with the reason.

## Out of scope

New colors, new spacing scale, dark-mode changes, animation work, accessibility rewrites, replacing shadcn primitives, touching `supabase/` or any `*.functions.ts`. If you find a real bug while sweeping, note it in the report — don't fix it in the same pass.
