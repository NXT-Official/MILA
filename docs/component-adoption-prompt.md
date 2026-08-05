# Prompt: make every repeated thing a component

Copy everything below the line into a fresh Claude Code session in this repo.

---

You are doing a full component-extraction and adoption pass on `/Users/user/nxt/MILA/app` (React 19 + TanStack Router/Start + Tailwind v4 + shadcn-style primitives in `src/components/ui/`, Supabase, tests via `bun test`).

**The goal, in priority order: (1) reusable — one definition per visual/structural idea; (2) less code — the tree should shrink, not grow; (3) clean — each file does one thing and reads short.** A change that adds abstraction without deleting duplication is a failure, not progress.

The codebase today: **127 `.tsx` files, 15,651 lines.** A successful pass ends with materially fewer lines _and_ fewer distinct ways to render the same widget.

## Context you must not undo

A five-phase styling consolidation already landed (commits `72e5caa`..`06c0a7f`). Build on it:

- **Type tokens** (`src/styles.css` `@theme`): `text-pico|nano|micro|label`, `tracking-label-tight|label|label-wide|label-xwide|label-max`. Zero arbitrary `text-[Npx]` / `tracking-[0.XXem]` remain — never reintroduce one.
- **`@utility`**: `atelier-label`, `atelier-glass`, `atelier-media-frame`, `atelier-row-action`, `atelier-headline`, `atelier-tile`.
- **`@layer components`**: `atelier-screen`, `atelier-page`, `atelier-container`, `atelier-card`, `atelier-hairline-card`, `atelier-hero-card`, `atelier-panel`, `atelier-kicker`, `atelier-title`, `atelier-focus-ring`, `atelier-dark-glass`. One prefix — `atelier-`. Do not start a second.
- **`Button`** has `size="pill" | "chip"` and `variant="glass"`. **`AvatarInitial`** lives at `components/ui/avatar-initial.tsx`.

## Inventory (measured — spot check, don't re-derive)

### What exists vs what is still hand-rolled

| Primitive                                    | Files importing               | Raw equivalents in the tree                                             |
| -------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `Button`                                     | 41                            | **112 raw `<button>`**                                                  |
| `Card`                                       | **1** (`login/auth-card.tsx`) | **18** `atelier-card` / `atelier-hairline-card` divs                    |
| `Badge`                                      | 5                             | pill `<span>`s — `profile.$userId.tsx:97,100,103`, `post-canvas.tsx:35` |
| `AvatarInitial`                              | 2                             | `profile.$userId.tsx:85` (a `size-20` disc)                             |
| `IconButton`                                 | 3                             | ~7 raw buttons whose only class is `size-N`                             |
| `Input`/`Textarea`/`Label`/`FormField`       | 8/4/6/—                       | 6 raw `<input>` (mostly hidden file pickers), 2 raw `<textarea>`        |
| `Select`                                     | 3                             | 0 raw `<select>` — **already clean, leave it**                          |
| `EmptyState`/`LoadErrorPanel`/`LoadingState` | 3/2/1                         | hand-rolled copies in `feed.tsx`, `history.tsx`                         |
| **Skeleton**                                 | **does not exist**            | `animate-pulse` blocks in **11 files**                                  |
| **PageHeader**                               | **does not exist**            | kicker+title+description in **13 files**                                |
| **ImageWithFallback**                        | **does not exist**            | `onError` fallback logic in **8 files**, 18 `<img>` total               |
| **OptionTile**                               | **does not exist**            | ~30 selection buttons across `style-profile/` + `onboarding/`           |
| headings                                     | —                             | 14 `<h1>`, 16 `<h2>`, 26 `<h3>`, 11 `<h4>`, all ad-hoc                  |

### The 112 raw `<button>`s are four different problems

Bucket every one before touching it.

1. **Real buttons in hand-typed clothes (~12)** → `<Button>` with an existing variant.
   `w-full py-3 rounded-lg bg-ink text-white text-label uppercase tracking-label` = `variant="primary"`; `w-full py-3 rounded-lg border border-destructive/30 text-destructive` ×2 = `variant="outline"` + destructive classes; `h-10 rounded-full border border-porcelain/60 atelier-label` ×2 = `size="pill"`; bare `text-sm text-ink` ×3 and `text-xs uppercase tracking-label text-muted hover:text-ink` ×2 = `ghost` or `editorial`. Also `feed.tsx:92` — a full CTA (`h-12 px-8 rounded-full bg-ink text-atelier-ivory ... shadow-atelier-soft`) typed by hand.
2. **Selection tiles (~30)** — the largest cluster, **no component exists**. `color-quiz.tsx` (13), `style-profile-page.tsx` (6), `shared.tsx` (4), `color-path-step.tsx` (4), `body-type-quiz.tsx` (3). Two recurring shapes:
   - flat: `` `w-full text-left border p-4 sm:p-5 rounded-none transition-all ${active ? "border-foreground bg-foreground/4" : "border-border hover:border-foreground/40"}` ``
   - card: `atelier-focus-ring rounded-card border border-line bg-surface p-5 text-left transition-colors hover:border-accent`
     → build **`OptionTile`**. Do **not** force these into `Button`: `Button` centers content and sets `[&_svg]:size-4`, which every one of these would have to override.
3. **Icon buttons (~7)** → `IconButton` (already exists: variants `primary|ghost|outline`, sizes `sm|md|lg`).
4. **Structural (~50) — leave raw.** `mobile-tab-bar.tsx` (2), `desktop-nav.tsx` (2), `history.tsx` HistoryCard (1, a card-sized photo target), `camera-capture.tsx` (6), `dual-capture.tsx` (6), `visual-diagnostic-viewfinder.tsx` (9), `expandable-text.tsx`, `save-status.tsx`, `studio-camera-drawer.tsx` (4). These already carry `atelier-tile` / `atelier-row-action` / `atelier-focus-ring` where shared styling exists. Wrapping them in `Button` buys nothing and risks layout regressions.

Never touch: `components/ui/icon-button.tsx`, `components/ui/password-visibility-button.tsx` (they _are_ the primitives), `lib/error-page.ts` (a raw HTML string for a pre-React error page).

### The biggest code-reduction win: the async state triad

Four routes render loading → error → empty → content, and **each does it differently**:

- `credit-packs.tsx` and `pricing.tsx` use the shared `LoadErrorPanel` + `EmptyState`, plus a hand-written skeleton grid (`atelier-card h-64 animate-pulse bg-foreground/6`, `h-100` in the other).
- `feed.tsx:99-125` hand-rolls all three: a bespoke skeleton, a bespoke error box (`rounded-3xl border border-destructive/30 p-8 text-center` + a raw retry button), a bespoke empty box (`border-dashed`).
- `history.tsx:323-339` hand-rolls all three again, with a third empty/error look (`atelier-card p-10 sm:p-16 text-center`).

That is four spellings of one control-flow shape. Collapse it — see phase C.

### Files that are too big to be one component

These are where "clean code" actually lands. Each is a single file doing five jobs:

`style-profile/style-profile-page.tsx` **949**, `style-profile/studio-portfolio-view.tsx` **739**, `account/studio-membership-drawer.tsx` **683**, `concierge/concierge-chat.tsx` **669**, `style-profile/visual-diagnostic-viewfinder.tsx` **631**, `style-profile/color-quiz.tsx` **575**.

Extraction here is in scope **only where it removes duplication** (a repeated sub-block, a repeated handler). Do not split a file merely because it is long — that moves lines, it doesn't reduce them. State the line delta for any file you split.

## Traps that silently change the design — read before writing code

1. **`Button`'s base cva contains `[&_svg]:size-4`.** Any converted button whose icon is `size-3.5`, `size-5`, or `size-8` **will resize**. Check every icon in every button you convert; pin the original with an explicit `[&_svg]:size-N`, or don't convert that site.
2. **`Button` base also adds** `gap-2`, `cursor-pointer`, `rounded-control`, `text-sm font-medium`, `disabled:opacity-50`, `atelier-focus-ring`, and a transform-capable transition. If the original had none of those (a bare text link), `variant="editorial"` is the honest match, not `ghost`.
3. **`type`**: a raw `<button>` inside a `<form>` defaults to `submit`. Preserve exactly what was there — add `type="button"` where the original had it, and don't add it where the original submitted.
4. **Links**: use `<Button asChild>` around a `<Link>`/`<a>`. Never nest a `Link` inside a styled `<button>`.
5. **`Card` vs `.atelier-card`**: the _only_ difference is that `Card` also applies `text-card-foreground`. Near-zero-risk swap — but check text color at each of the 18 sites, especially on dark or image backgrounds, and report any that shift.
6. **Hidden file inputs** (`app-shell.tsx:212`, `studio-camera-drawer.tsx:306`) are `type="file" accept="image/*" className="hidden"` + a ref + an onChange that resets `e.target.value`. If you extract these, the value-reset must survive or re-picking the same file silently stops working.
7. Preserve every `aria-label`, `aria-*`, `role`, `disabled`, and keyboard handler exactly. Several skeletons carry `role="status"` + `aria-label` — those must survive extraction.

## Work — one phase per commit

**Phase A — `OptionTile`.** Build it first; it unblocks the biggest bucket. `variant` for the two shapes (`flat` = `rounded-none` bordered row, `card` = `rounded-card bg-surface p-5`), `selected` for active state, children for content. Convert the ~30 sites in `style-profile/` and `onboarding/steps/`. These are quiz answers — verify each quiz's selected state still reads correctly, and that `color-quiz.tsx` shrinks substantially.

**Phase B — `Button` bucket 1 + `IconButton` bucket 3.** Convert only buttons that map onto an existing variant. If a button needs more than ~2 extra classes on top of a variant, either add a variant to the `cva` (when 3+ sites want it) or leave it raw and say so.

**Phase C — async state: `Skeleton` + one state shape.** Add a `Skeleton` primitive (`animate-pulse` + `bg-foreground/6` + a `className` passthrough) and use it in all 11 files. Then make the four routes share one loading/error/empty structure. Prefer the boring version: use the existing `LoadingState` / `LoadErrorPanel` / `EmptyState` in `feed.tsx` and `history.tsx` instead of their hand-rolled copies. Only introduce an `AsyncSection`-style wrapper if, after that, 3+ routes still repeat the same ternary chain. **This phase should delete the most lines of any — report the count.**

**Phase D — `PageHeader`.** Kicker + title + optional description appears in 13 files (`history.tsx:315`, `pricing.tsx:31`, `credit-packs.tsx:30`, `dashboard.tsx:235,250,404`, …) with drifting margins (`mb-3` vs `mb-2`, `mb-8 sm:mb-12` vs `mb-10 sm:mb-14`, centered vs left). Build one component with an `align` prop; pick the dominant spacing and list every site whose margins you normalized.

**Phase E — `Card`, `Badge`, `Avatar`, `ImageWithFallback`.**

- Replace the 18 `atelier-card`/`atelier-hairline-card` divs with `<Card>`. Decide which of those two classes is canonical — **they currently have identical definitions**, so one should stop existing.
- Convert label-bearing pill `<span>`s to `<Badge>` (add a variant if none match).
- Fold `profile.$userId.tsx:85` into `AvatarInitial` as a size/variant, not a pile of overrides.
- Extract `ImageWithFallback` from `history.tsx`'s local `HistoryImage` (broken-state + `ImageOff` placeholder) and adopt it in the 8 files doing `onError` by hand.

**Phase F — typography, CSS-first.** A `<Text>`/`<Heading>` component in a Tailwind codebase is often _worse_ than a class, and `atelier-title` / `atelier-headline` / `atelier-kicker` / `atelier-label` already provide one source of truth. So:

1. Sweep the 67 raw `<h1>`–`<h4>` onto those four classes wherever one matches (`font-serif text-2xl tracking-tight leading-snug` → `atelier-headline`, etc.).
2. Only then, if 3+ distinct heading recipes still have no class, add **one** `Heading` component whose `size` prop maps to those classes — not a parallel styling system.
3. Report how many headings landed on an existing class vs needed something new.

## Rules

1. **No new dependencies. No new naming prefix. No new arbitrary Tailwind values.**
2. **Zero visual change.** Every conversion renders identically — same size, weight, icon size, hover, focus ring, spacing. If a conversion would shift pixels, fix it with an explicit class or skip the site and list it.
3. **Extraction threshold: 3+ occurrences, or 2 in different feature areas.** A component used once is worse than the inline JSX it replaced. This applies to every phase.
4. **Convert only when the element _is_ the thing.** A `<div>` with a border is not a Card. A `<button>` that is a whole clickable photo tile is not a Button.
5. New components go in `components/ui/` only if they are generic; feature-specific ones live next to their feature. Every one takes `className` and merges via `cn()`.
6. No new prop that has exactly one value at every call site. No `variant` with one member. Delete the old code in the same commit that adds its replacement — no dead helpers left behind.
7. Don't touch `supabase/`, `*.functions.ts`, or test files.

After **each** phase:

```bash
npx tsc --noEmit && bun test && bunx eslint src --max-warnings=0 && bun run build
```

All four must pass before committing and moving on. `bun run build` is not optional — it is the only check that catches a Tailwind class that doesn't exist.

## Acceptance

Report before/after for each number, with a reason for every remaining raw element:

```bash
find src -name "*.tsx" | xargs cat | wc -l          # 15651 -> must be LOWER
grep -rho "<button" src | wc -l                      # 112 -> ~45-55, all bucket 4
grep -rho "atelier-card\|atelier-hairline-card" src | wc -l  # 18 -> ~1
grep -rl "components/ui/card" src | wc -l            # 1 -> 10+
grep -rlc "animate-pulse" src | wc -l                # 11 files -> 1 (the Skeleton)
grep -rn "onError" src/components src/routes | wc -l # 22 -> ~2
grep -rhoE "tracking-\[|text-\[[0-9]+px\]" src       # must stay empty
```

The final report must contain: total line delta; the four button buckets with counts and destinations; every icon whose `size-N` you pinned because of `[&_svg]:size-4`; every site skipped and why; every new component with its call-site count (flag any under 3); every spacing/margin you normalized in `PageHeader`; and confirmation all four checks passed on every phase.

**If the line count went up, say so plainly at the top of the report and explain which phase caused it.**

## Out of scope

Redesigns, new colors, radius changes, dark-mode work, accessibility rewrites beyond preserving what exists, `Select` (already clean), route/data-fetching refactors, and splitting large files where it does not remove duplication.
