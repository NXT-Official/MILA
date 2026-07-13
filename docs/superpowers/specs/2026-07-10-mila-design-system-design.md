# Mila Design System Refactor — Design

## Context

`src/styles.css` already contains a near-complete "atelier" palette matching the target brand kit (Ivory `#F5F0E8`, Gold `#C9A96E`, Parchment `#F5ECD9`, Charcoal `#2B2320`, Stone `#6B6259`, White `#FAF8F5`), but it's fragmented: mixed oklch/hex formats, a redundant `atelier-*` naming layer duplicating standard shadcn tokens, near-identical duplicate card classes (`.atelier-card` / `.atelier-hairline-card`), no radius/shadow/motion token scale, and only 4 of 19 `components/ui/` primitives use CVA variants. This is a consolidation and extension of an existing system, not a greenfield build.

The app has a working light/dark theme toggle (`ThemeProvider` + `.dark` class) that must be preserved — the source spec doesn't mention dark mode, so both palettes get updated in parallel.

Fonts (Playfair Display, Inter) are already loaded via Google Fonts `<link>` in `__root.tsx`.

## Token layer (`src/styles.css`)

Single source of truth, no `tailwind.config.*` involved (pure v4 CSS-first).

- Replace `atelier-*` hex variables with the spec's semantic names as raw values in `:root`/`.dark`: `--color-canvas`, `--color-accent`, `--color-accent-soft`, `--color-line`, `--color-ink`, `--color-muted`, `--color-surface`.
- Add radius scale: `--radius-control` (0.75rem), `--radius-panel` (1rem), `--radius-card` (1.25rem), `--radius-overlay` (1.5rem), `--radius-pill` (9999px).
- Add shadow scale: `--shadow-paper`, `--shadow-raised`, `--shadow-nav`.
- Add `--ease-editorial: cubic-bezier(0.22, 1, 0.36, 1)`.
- Add container widths: `--container-reading` (46rem), `--container-content` (72rem), `--container-wide` (84rem).
- Rename `--font-serif` → `--font-display` (spec explicitly requests the `font-display` utility); keep `--font-sans`.
- Add restrained `--color-success` / `--color-warning` tokens (accessible, warm-compatible); reuse existing `--color-destructive` for error.
- **Keep shadcn compatibility slots** (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*`, `chart-*`) — remap their values onto the new semantic tokens rather than deleting them, since Radix-derived primitives (dialog, select, dropdown-menu, popover, sheet) reference them internally. Rewriting 15 primitive files' internal wiring for zero visual gain is out of scope.
- **Naming collision, resolved deliberately**: shadcn's `accent` slot means "neutral hover/highlight background" in dropdown/select item hover; the spec's `accent` means gold brand color. Point shadcn's hover-highlight slot at `accent-soft` instead of raw gold, so menu hovers don't turn solid gold everywhere. Raw `accent` is reserved for text/icons/focus rings/active indicators.
- Collapse `.atelier-card` / `.atelier-hairline-card` duplication into one `.mila-card` component class.
- Replace the five `atelier-*` `@layer components` classes with the spec's `.mila-*` set (`mila-page`, `mila-container`, `mila-section`, `mila-card`, `mila-panel`, `mila-focus-ring`, `mila-eyebrow`, `mila-editorial-divider`, `mila-dark-glass`).
- Base layer: paper-grain texture already exists as an inline SVG data-URI on `body` — keep it, verify low opacity, add `pointer-events-none` if missing, and gate/simplify under `prefers-reduced-transparency`/`prefers-contrast` if not already. Add `prefers-reduced-motion` guards. Add elegant `::selection` styling (`accent-soft` bg / `ink` text).

## Component strategy

- **Existing primitives with CVA already** (`badge`, `button`, `label`, `sheet`): rebuild `Button` per spec's variant/size table; audit others for token usage.
- **Existing primitives without CVA** (`card`, `input`, `select`, `dialog`, `dropdown-menu`, `table`, `tabs`, `textarea`, `popover`, `switch`, `accordion`, `carousel`, `data-table*`, `sonner`): migrate hardcoded classes to semantic tokens; add CVA only where real variants exist (e.g. Card compact/standard/feature padding), not speculatively.
- **New primitives, no new dependencies**: `Container`, `Section`, `IconButton`, `PageHeader`, `SectionHeader`, `EmptyState`, `LoadingState`, plain `Avatar` (image + initials fallback — no `@radix-ui/react-avatar`, unwarranted for a static image with no interactive behavior).
- `ErrorState`: extract the existing `ErrorComponent` pattern in `__root.tsx` into a reusable component rather than duplicating it.
- "Checkbox or Switch" requirement satisfied by existing `@radix-ui/react-switch` — no new checkbox dependency.
- `FormField` wrapper: standardize label/description/error spacing around existing React Hook Form usage without touching validation logic.

## Button variants (CVA)

`primary` (charcoal bg / warm-white text), `secondary` (warm-white surface / charcoal text / gold-muted border), `outline` (transparent / gold-muted border), `ghost` (transparent / accent-soft hover), `editorial` (text-based, underline/arrow detail), `destructive`. Sizes: `sm`, `md`, `lg`, `icon`. All variants: consistent height, visible focus ring, disabled state, loading state with no layout shift, icon spacing, touch-friendly targets.

## Execution order

1. Token layer + base styles in `styles.css` (single commit).
2. `components/ui/` primitives — Button rebuild, CVA additions, token migration across all 19 files, new primitives added.
3. Layout/nav — dark glassmorphic bar (`mila-dark-glass`), nav active states.
4. Sweep all 9 routes (`index`, `login`, `auth/callback`, `dashboard`, `feed`, `history`, `style-profile`, `admin` ×4) and feature components (`landing/`, `dashboard/`, `admin/`, `login/`, `capture/`, `feed/`, `studio/`, `style-profile/`, `wardrobe/`, `account/`) replacing `bg-white`, `text-black`, arbitrary `rounded-[...]`, duplicated className strings, and inline style objects used only for visual styling.
5. Validation: `bun run lint`, `bun run build`, formatter on touched files.

Each phase committed separately on `main` for bisectability.

## Explicitly out of scope

- No application logic, routing, auth, API, or validation-logic changes.
- No new dependencies beyond what's already installed.
- No renaming of shadcn's internal compatibility slot names (`background`, `card`, `primary`, etc.) — only their values change.
- Color-analysis feature hex values (season/palette swatches in `style-profile/`, `wardrobe/DailyPaletteGenerator.tsx`) are data-driven, not UI styling — left untouched.
