# Mila Design System Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the fragmented "atelier" token system in `src/styles.css` into one canonical warm-editorial design system, rebuild `components/ui/` primitives on top of it, and sweep all 9 routes / ~64 components to remove hardcoded visual values — without touching application logic, auth, routing, or validation behavior.

**Architecture:** Single global stylesheet (`src/styles.css`) defines canonical semantic tokens via Tailwind v4 `@theme inline` + `:root`/`.dark`. Existing shadcn compatibility slots (`background`, `card`, `primary`, `accent`, `border`, etc.) stay in place and get remapped onto the new values — no renaming of shadcn's own slot names, since Radix-derived primitives depend on them internally. Existing "bare alias" utilities already in use across ~35 files (`text-ink`, `text-stone`, `bg-porcelain`, `border-rose`) are **kept as aliases pointing at the new canonical vars**, not mechanically renamed — this avoids a ~300-call-site rename with zero visual benefit. New/rewritten component code uses the canonical names (`bg-canvas`, `text-muted`, `bg-surface`, `border-line`, `bg-accent-soft`) going forward.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4.2 (`@tailwindcss/vite`, CSS-first config, no `tailwind.config.*`), Radix UI, class-variance-authority, clsx, tailwind-merge, Framer Motion, Lucide React, TanStack Router/Start, React Hook Form, Sonner. No test runner is configured in this repo — verification is `bun run lint`, `bunx tsc --noEmit`, and `bun run build` per task, plus a manual dev-server visual check for pages touched.

## Global Constraints

- Do not change application logic, API behavior, auth, routing, database logic, or form validation logic.
- No new dependencies. Radix primitives already installed: accordion, dialog, dropdown-menu, label, popover, select, slot, switch, tabs. No avatar/checkbox/tooltip package — build plain equivalents where the spec asks for them.
- Preserve light/dark theme parity (`ThemeProvider` + `.dark` class) — every new/changed token gets both a `:root` and `.dark` value.
- Preserve Radix accessibility behavior, portals, keyboard interactions, ARIA attributes, focus management.
- `cn()` at `src/lib/utils.ts` is canonical — do not create another.
- Radius hierarchy: `rounded-control` (buttons/inputs/compact controls), `rounded-panel` (secondary panels), `rounded-card` (main cards), `rounded-overlay` (dialogs/sheets), `rounded-pill` (badges/avatars/tags — numerically identical to Tailwind's native `rounded-full`, so existing `rounded-full` call sites are left as-is, not mass-renamed).
- Color-analysis feature hex values (`style-profile/*`, `wardrobe/DailyPaletteGenerator.tsx`) are palette _data_, not UI styling — out of scope, do not touch.
- `--color-rose` (used 3×: `style-profile.tsx`, `studio/style-profile.tsx`) is a supplementary decorative token with no spec equivalent — leave its value and usages as-is.
- Commit after each task on `main`.

---

### Task 1: Canonical token layer + base styles

**Files:**

- Modify: `src/styles.css` (full file, 286 lines)

**Interfaces:**

- Produces (new canonical CSS custom properties, usable as Tailwind utilities): `--color-canvas` → `bg-canvas`/`text-canvas`, `--color-accent` → `*-accent`, `--color-accent-soft` → `*-accent-soft`, `--color-line` → `*-line`, `--color-ink` → `*-ink` (already existed as bare alias, now canonical), `--color-muted` → `*-muted` (shadcn already defines `--muted`/`--muted-foreground`; this adds a flat `--color-muted` text-color alias distinct from the shadcn `muted` surface pair), `--color-surface` → `*-surface`, `--radius-control`, `--radius-panel`, `--radius-card`, `--radius-overlay`, `--radius-pill`, `--shadow-paper`, `--shadow-raised`, `--shadow-nav`, `--ease-editorial`, `--container-reading`, `--container-content`, `--container-wide`, `--font-display` (renamed from `--font-serif`), `--color-success`, `--color-warning`.
- Produces (component classes): `.mila-page`, `.mila-container`, `.mila-section`, `.mila-card`, `.mila-panel`, `.mila-focus-ring`, `.mila-eyebrow`, `.mila-editorial-divider`, `.mila-dark-glass`, `.mila-hero-wash` (gradient wash, replaces `.atelier-hero-card`), `.mila-title` (renamed from `.atelier-title`).
- Consumes: nothing (this is the base layer every later task builds on).

- [ ] **Step 1: Replace `@theme inline` block**

Replace lines 21-78 with:

```css
@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);
  --radius-3xl: calc(var(--radius) + 12px);
  --radius-4xl: calc(var(--radius) + 16px);
  --radius-control: 0.75rem;
  --radius-panel: 1rem;
  --radius-card: 1.25rem;
  --radius-overlay: 1.5rem;
  --radius-pill: 9999px;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted-foreground);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent-soft: var(--accent-soft);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-border: var(--border);
  --color-line: var(--border);
  --color-canvas: var(--canvas);
  --color-surface: var(--card);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-ring-offset-background: var(--background);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-atelier-ivory: var(--canvas);
  --color-atelier-porcelain: var(--card);
  --color-atelier-ink: var(--ink);
  --color-atelier-champagne: var(--accent);
  --color-atelier-rose: var(--rose);
  --color-atelier-stone: var(--muted-foreground);
  --color-atelier-panel: var(--atelier-panel);
  /* Bare aliases kept for the ~35 existing call sites using text-ink /
     text-stone / border-porcelain / text-rose without an atelier- prefix.
     New code should prefer the canonical names: ink, muted, surface,
     canvas, accent, accent-soft, line. */
  --color-ink: var(--ink);
  --color-stone: var(--muted-foreground);
  --color-porcelain: var(--card);
  --color-rose: var(--rose);
  --shadow-atelier-soft: var(--shadow-paper);
  --shadow-atelier-float: var(--shadow-raised);
  --shadow-paper: var(--shadow-paper-value);
  --shadow-raised: var(--shadow-raised-value);
  --shadow-nav: var(--shadow-nav-value);
  --font-display: var(--font-display-family);
  --font-sans: var(--font-sans-family);
  --ease-editorial: var(--ease-editorial-value);
  --container-reading: 46rem;
  --container-content: 72rem;
  --container-wide: 84rem;
}
```

**Why the indirection** (e.g. `--shadow-paper: var(--shadow-paper-value)`): Tailwind v4 requires theme keys to be plain `@theme` entries to generate utilities, but the actual shadow/font values differ between light and dark in this codebase's pattern for other tokens — practice here (see `--atelier-shadow-soft`) is theme key maps to a `:root`/`.dark`-defined variable. `--shadow-nav` and `--ease-editorial` don't change between themes, so define them directly in `:root` only (still referenced via the indirection var for consistency).

- [ ] **Step 2: Update `:root` block**

Replace lines 80-136 with (adds `--canvas`, `--ink` as primary names alongside existing values, adds `--accent-soft`, `--success`, `--warning`, `--shadow-*-value`, `--ease-editorial-value`, `--font-display-family`/`--font-sans-family`, renames `--font-serif`→ kept as fallback alias since `.font-serif` class in base layer still references it — see Step 4):

```css
:root {
  color-scheme: light;
  --radius: 0.25rem;
  /* Brand kit palette: Ivory #F5F0E8 · Gold #C9A96E · Parchment #F5ECD9 ·
     Gold Muted #E8D5B0 · Charcoal #2B2320 · Stone #6B6259 · White #FAF8F5 */
  --canvas: #f5f0e8;
  --background: var(--canvas);
  --ink: oklch(0.264 0.013 41.6); /* Atelier Charcoal #2B2320 */
  --foreground: var(--ink);
  --card: #faf8f5;
  --card-foreground: var(--ink);
  --popover: oklch(0.98 0.005 78.3);
  --popover-foreground: var(--ink);
  --primary: var(--ink); /* Charcoal — Dark / CTA */
  --primary-foreground: oklch(0.98 0.005 78.3); /* Warm White #FAF8F5 */
  --secondary: oklch(0.95 0.008 70);
  --secondary-foreground: var(--ink);
  --muted: oklch(0.95 0.008 70);
  --muted-foreground: oklch(0.502 0.018 67.4); /* Warm Stone #6B6259 */
  --accent: oklch(0.75 0.085 82.1); /* Champagne Gold #C9A96E — brand accent */
  --accent-foreground: var(--ink);
  --accent-soft: oklch(
    0.945 0.027 85.7
  ); /* Parchment #F5ECD9 — soft gold wash, used for hover/highlight surfaces */
  --destructive: oklch(0.55 0.2 27);
  --destructive-foreground: oklch(0.98 0.005 75);
  --success: oklch(0.52 0.1 152); /* muted forest, warm-compatible */
  --success-foreground: oklch(0.98 0.005 75);
  --warning: oklch(0.62 0.14 55); /* warm amber-rust, distinct from gold accent */
  --warning-foreground: oklch(0.2 0.02 55);
  /* Gold Muted per brand kit — "structural warmth without weight" */
  --border: #e8d5b0;
  --input: oklch(0.879 0.053 84); /* Gold Muted #E8D5B0 */
  --ring: oklch(0.75 0.085 82.1); /* Champagne Gold #C9A96E */
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.98 0.005 75);
  --sidebar-foreground: oklch(0.22 0.015 50);
  --sidebar-primary: oklch(0.22 0.015 50);
  --sidebar-primary-foreground: oklch(0.98 0.005 75);
  --sidebar-accent: oklch(0.94 0.01 70);
  --sidebar-accent-foreground: oklch(0.22 0.015 50);
  --sidebar-border: oklch(0.9 0.01 70);
  --sidebar-ring: oklch(0.72 0.08 40);
  --font-display-family: "Playfair Display", "Times New Roman", Georgia, serif;
  --font-sans-family: "Inter", Helvetica, Arial, sans-serif;
  --font-serif: var(--font-display-family); /* back-compat for .font-serif usages */
  --rose: oklch(0.76 0.055 25);
  --atelier-panel: oklch(1 0.003 80 / 78%);
  --shadow-paper-value:
    0 1px 2px oklch(0.264 0.013 41.6 / 0.04), 0 10px 30px oklch(0.264 0.013 41.6 / 0.07);
  --shadow-raised-value:
    0 4px 10px oklch(0.264 0.013 41.6 / 0.06), 0 20px 50px oklch(0.264 0.013 41.6 / 0.1);
  --shadow-nav-value: 0 12px 40px oklch(0.1 0.01 55 / 0.2);
  --ease-editorial-value: cubic-bezier(0.22, 1, 0.36, 1);
  --atelier-gold: #c9a96e;
  --atelier-gold-light: #f5ecd9;
  --atelier-gold-muted: #e8d5b0;
  --body-foreground: #6b6259;
}
```

- [ ] **Step 3: Update `.dark` block**

Replace lines 138-189 with the same structural additions (dark-tuned values):

```css
.dark {
  color-scheme: dark;
  --canvas: oklch(0.16 0.01 60);
  --background: var(--canvas);
  --ink: oklch(0.93 0.008 75);
  --foreground: var(--ink);
  --card: oklch(0.205 0.012 60);
  --card-foreground: var(--ink);
  --popover: oklch(0.215 0.012 60);
  --popover-foreground: var(--ink);
  --primary: var(--ink);
  --primary-foreground: oklch(0.2 0.012 55);
  --secondary: oklch(0.26 0.012 60);
  --secondary-foreground: var(--ink);
  --muted: oklch(0.26 0.012 60);
  --muted-foreground: oklch(0.7 0.015 65);
  --accent: oklch(0.76 0.055 75); /* champagne gold, dark-tuned */
  --accent-foreground: oklch(0.16 0.012 55);
  --accent-soft: oklch(0.32 0.03 80); /* dark champagne wash */
  --destructive: oklch(0.62 0.19 27);
  --destructive-foreground: oklch(0.98 0.005 75);
  --success: oklch(0.65 0.11 152);
  --success-foreground: oklch(0.16 0.02 55);
  --warning: oklch(0.72 0.13 60);
  --warning-foreground: oklch(0.16 0.02 55);
  --border: oklch(0.95 0.01 70 / 12%);
  --input: oklch(0.95 0.01 70 / 16%);
  --ring: oklch(0.75 0.085 82.1);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.205 0.012 60);
  --sidebar-foreground: oklch(0.93 0.008 75);
  --sidebar-primary: oklch(0.72 0.08 40);
  --sidebar-primary-foreground: oklch(0.98 0.005 75);
  --sidebar-accent: oklch(0.26 0.012 60);
  --sidebar-accent-foreground: oklch(0.93 0.008 75);
  --sidebar-border: oklch(0.95 0.01 70 / 12%);
  --sidebar-ring: oklch(0.72 0.08 40);
  --rose: oklch(0.68 0.055 25);
  --atelier-panel: oklch(0.2 0.012 55 / 78%);
  --shadow-paper-value: 0 1px 2px oklch(0 0 0 / 0.3), 0 10px 30px oklch(0 0 0 / 0.35);
  --shadow-raised-value: 0 4px 10px oklch(0 0 0 / 0.35), 0 20px 50px oklch(0 0 0 / 0.45);
  --shadow-nav-value: 0 12px 40px oklch(0 0 0 / 0.5);
  --atelier-gold: #c9a96e;
  --atelier-gold-light: rgb(201 169 110 / 14%);
  --atelier-gold-muted: rgb(201 169 110 / 40%);
  --body-foreground: oklch(0.74 0.015 70);
}
```

- [ ] **Step 4: Update `@layer base`**

Replace lines 191-238 with:

```css
@layer base {
  * {
    border-color: var(--color-border);
  }

  ::selection {
    background-color: var(--accent-soft);
    color: var(--ink);
  }

  body {
    background-color: var(--background);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
    background-attachment: fixed;
    pointer-events: auto;
    color: var(--body-foreground);
    font-family: var(--font-sans);
    font-size: 1rem;
    font-weight: 400;
    line-height: 1.625;
    letter-spacing: 0;
    font-feature-settings: "ss01", "cv11";
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  button,
  input,
  textarea,
  select {
    font-family: inherit;
  }

  h1,
  h2,
  h3,
  .font-serif {
    font-family: var(--font-display);
    letter-spacing: -0.01em;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    color: var(--color-foreground);
  }

  h1 {
    font-size: 3.25rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1;
  }

  h2 {
    font-size: 2rem;
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: 1.25;
  }

  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    ::before,
    ::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }

  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    body {
      background-image: none;
    }
  }
}
```

- [ ] **Step 5: Update `@layer components`**

Replace lines 240-285 with:

```css
@layer components {
  .mila-page {
    @apply min-h-screen bg-canvas text-ink;
  }

  .mila-container {
    @apply mx-auto w-full max-w-content px-5 sm:px-8 lg:px-10;
  }

  .mila-section {
    @apply py-14 md:py-20 lg:py-24;
  }

  .atelier-page {
    @apply mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-12 lg:py-14;
  }

  .mila-card {
    @apply rounded-card border border-line bg-surface shadow-paper;
  }

  .atelier-card,
  .atelier-hairline-card {
    @apply mila-card;
  }

  .mila-hero-wash {
    background: linear-gradient(145deg, #f0e6d3 0%, #faf8f5 60%, #f5f0e8 100%);
  }
  .dark .mila-hero-wash {
    background: linear-gradient(
      145deg,
      oklch(0.24 0.02 70) 0%,
      oklch(0.205 0.012 60) 60%,
      oklch(0.225 0.016 65) 100%
    );
  }
  .atelier-hero-card {
    @apply mila-hero-wash;
  }

  .mila-panel {
    @apply rounded-panel border border-line/80 bg-accent-soft/45;
  }

  .mila-eyebrow {
    @apply text-xs font-semibold uppercase tracking-[0.16em] text-accent;
  }
  .atelier-kicker {
    @apply mila-eyebrow;
  }

  .mila-title {
    font-family: var(--font-display);
    font-size: clamp(2.25rem, 6vw, 3rem);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .atelier-title {
    @apply mila-title;
  }

  .mila-editorial-divider {
    @apply h-px w-full bg-line;
  }

  .mila-focus-ring {
    @apply outline-none focus-visible:ring-2 focus-visible:ring-accent
      focus-visible:ring-offset-2 focus-visible:ring-offset-canvas;
  }

  .mila-dark-glass {
    @apply border border-white/10 bg-ink/90 text-surface shadow-nav
      backdrop-blur-xl;
  }
}
```

(`.atelier-page`, `.atelier-card`, `.atelier-hairline-card`, `.atelier-hero-card`, `.atelier-kicker`, `.atelier-title` are kept as thin aliases so the ~35 files using them today keep working unchanged; `.atelier-button-pill` is dropped — grep confirmed 0 usages.)

- [ ] **Step 6: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

Expected: all three succeed with no new errors (styles.css changes are pure CSS, but `bun run build` exercises the Vite/Tailwind pipeline end-to-end and will fail loudly on a malformed `@theme` block).

Then run `bun run dev`, open `/`, `/login`, `/dashboard` and toggle dark mode — confirm no visual regression (canvas/card/ink/accent colors should look identical to before, since values are unchanged, only re-keyed).

- [ ] **Step 7: Commit**

```bash
git add src/styles.css
git commit -m "$(cat <<'EOF'
refactor(styles): consolidate atelier tokens into canonical Mila design system

Adds canonical semantic tokens (canvas, accent, accent-soft, line, ink,
muted, surface), the radius/shadow/motion/container scale from the Mila
spec, and success/warning status colors. Existing atelier-* classes and
bare aliases (text-ink, text-stone, bg-porcelain) are kept as aliases
onto the same values so no visual change occurs yet and no call sites
break; later tasks migrate individual components onto the canonical
names.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Button component rebuild (CVA)

**Files:**

- Modify: `src/components/ui/button.tsx`

**Interfaces:**

- Consumes: `cn` from `src/lib/utils.ts`; tokens from Task 1 (`rounded-control`, `accent`, `accent-soft`, `ink`, `surface`, `line`, `mila-focus-ring`).
- Produces: `Button` component and `buttonVariants` CVA export with variants `primary | secondary | outline | ghost | editorial | destructive` and sizes `sm | md | lg | icon`, plus a `loading?: boolean` prop. Later tasks (IconButton, all feature components using `<Button>`) rely on this exact variant/size vocabulary — **note the existing file currently uses `variant="default"` as its default variant name; this task renames it to `"primary"` and every call site using `variant="default"` or omitting `variant` needs no change only if `"primary"` is the CVA default**, but any call site with explicit `variant="default"` must be updated to `variant="primary"` in Task 6/7/8's sweep (grep `variant="default"` before those tasks).

- [ ] **Step 1: Read the current file to confirm existing variant names and call-site risk**

```bash
cat src/components/ui/button.tsx
grep -rn 'variant="default"\|variant="destructive"\|variant="outline"\|variant="ghost"\|variant="secondary"\|variant="link"' src --include="*.tsx" | wc -l
```

Note the count — this is how many call sites Task 6/7/8 must sanity-check still resolve to a valid variant name after the rename.

- [ ] **Step 2: Rewrite the component**

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "mila-focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-editorial disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-surface hover:-translate-y-px hover:bg-ink/90 active:translate-y-0",
        secondary:
          "border border-line bg-surface text-ink hover:bg-accent-soft/60 active:bg-accent-soft/80",
        outline: "border border-line bg-canvas text-ink hover:bg-accent-soft/40",
        ghost: "bg-transparent text-ink hover:bg-accent-soft/50",
        editorial:
          "h-auto rounded-none bg-transparent p-0 text-ink underline decoration-line decoration-1 underline-offset-4 hover:decoration-accent",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        sm: "h-9 px-3.5 text-xs",
        md: "h-11 px-5",
        lg: "h-12 px-7 text-base",
        icon: "size-11 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

Note: `editorial` intentionally overrides `h-*`/`px-*`/`rounded-control` from the base string via Tailwind's cascade (later classes win when using `cn`/`twMerge`, which dedupes conflicting utility groups) — this keeps it text-based per spec instead of pill-shaped.

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
bun run lint -- src/components/ui/button.tsx
```

Expected: no type errors from the `ButtonProps` change. `tsc` will surface every call site using an invalid `variant` value (e.g. `"default"` or `"link"`) as a compile error — **fix each one now** by changing `variant="default"` → `variant="primary"` (or omit the prop) and `variant="link"` → `variant="editorial"`, since Task 1's constraint is that build/lint must pass after every task, not deferred to Task 6-8.

- [ ] **Step 4: Manual check**

`bun run dev`, visit a page using Button (e.g. `/login`), confirm it renders with charcoal background / warm-white text, visible hover lift, visible focus ring on Tab.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(ui): rebuild Button on CVA with Mila variant system

Adds primary/secondary/outline/ghost/editorial/destructive variants and
sm/md/lg/icon sizes per the design spec, plus a loading state with no
layout shift. Updates call sites using the old default/link variant
names.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: New primitives — Container, Section, IconButton, PageHeader, SectionHeader, EmptyState, LoadingState, Avatar

**Files:**

- Create: `src/components/ui/container.tsx`
- Create: `src/components/ui/section.tsx`
- Create: `src/components/ui/icon-button.tsx`
- Create: `src/components/ui/page-header.tsx`
- Create: `src/components/ui/section-header.tsx`
- Create: `src/components/ui/empty-state.tsx`
- Create: `src/components/ui/loading-state.tsx`
- Create: `src/components/ui/avatar.tsx`

**Interfaces:**

- Consumes: `cn`, `buttonVariants`/`Button` from Task 2, Lucide icons, tokens from Task 1.
- Produces: `Container`, `Section`, `IconButton`, `PageHeader`, `SectionHeader`, `EmptyState`, `LoadingState`, `Avatar` — all used by Tasks 5-8's route/component sweeps. Exact prop shapes below are the contract later tasks must match.

- [ ] **Step 1: `Container`**

```tsx
// src/components/ui/container.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const widthMap = {
  reading: "max-w-reading",
  content: "max-w-content",
  wide: "max-w-wide",
} as const;

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: keyof typeof widthMap;
}

export function Container({ width = "content", className, ...props }: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full px-5 sm:px-8 lg:px-10", widthMap[width], className)}
      {...props}
    />
  );
}
```

- [ ] **Step 2: `Section`**

```tsx
// src/components/ui/section.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  as?: "section" | "div";
}

export function Section({ as = "section", className, ...props }: SectionProps) {
  const Comp = as;
  return <Comp className={cn("py-14 md:py-20 lg:py-24", className)} {...props} />;
}
```

- [ ] **Step 3: `IconButton`**

```tsx
// src/components/ui/icon-button.tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const iconButtonVariants = cva(
  "mila-focus-ring inline-flex shrink-0 items-center justify-center rounded-control transition-colors duration-200 ease-editorial disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-ink text-surface hover:bg-ink/90",
        ghost: "bg-transparent text-ink hover:bg-accent-soft/50",
        outline: "border border-line bg-canvas text-ink hover:bg-accent-soft/40",
      },
      size: {
        sm: "size-9",
        md: "size-11",
        lg: "size-12",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  label: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, label, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(iconButtonVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = "IconButton";
```

- [ ] **Step 4: `PageHeader` and `SectionHeader`**

```tsx
// src/components/ui/page-header.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}
      {...props}
    >
      <div className="max-w-reading">
        {eyebrow ? <p className="mila-eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          {title}
        </h1>
        {description ? <p className="mt-3 text-base text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </div>
  );
}
```

```tsx
// src/components/ui/section-header.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div className={cn("max-w-reading", className)} {...props}>
      {eyebrow ? <p className="mila-eyebrow mb-2">{eyebrow}</p> : null}
      <h2 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {title}
      </h2>
      {description ? <p className="mt-3 text-base text-muted">{description}</p> : null}
    </div>
  );
}
```

- [ ] **Step 5: `EmptyState` and `LoadingState`**

```tsx
// src/components/ui/empty-state.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "mila-panel flex flex-col items-center gap-3 px-6 py-14 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="text-accent" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="font-display text-xl font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-reading text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
```

```tsx
// src/components/ui/loading-state.tsx
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function LoadingState({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 py-14 text-muted", className)}
      role="status"
    >
      <Loader2 className="size-6 animate-spin text-accent" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
```

- [ ] **Step 6: `Avatar`**

```tsx
// src/components/ui/avatar.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string | null;
  alt: string;
  fallback: string;
  size?: "sm" | "md" | "lg";
}

const sizeMap = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-base" } as const;

export function Avatar({ src, alt, fallback, size = "md", className, ...props }: AvatarProps) {
  const [errored, setErrored] = React.useState(false);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill border border-line bg-accent-soft font-medium text-ink",
        sizeMap[size],
        className,
      )}
      {...props}
    >
      {src && !errored ? (
        <img
          src={src}
          alt={alt}
          className="size-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span aria-hidden="true">{fallback}</span>
      )}
    </span>
  );
}
```

- [ ] **Step 7: Verify**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: no errors (these are new, unused-until-wired files — `tsc`/eslint must still accept them standalone).

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/container.tsx src/components/ui/section.tsx src/components/ui/icon-button.tsx src/components/ui/page-header.tsx src/components/ui/section-header.tsx src/components/ui/empty-state.tsx src/components/ui/loading-state.tsx src/components/ui/avatar.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add Container, Section, IconButton, PageHeader, SectionHeader, EmptyState, LoadingState, Avatar primitives

No new dependencies — Avatar is a plain image+fallback wrapper since
no interactive/portal behavior is needed and @radix-ui/react-avatar
isn't installed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Extract `ErrorState`, add `FormField` wrapper, migrate remaining `ui/` primitives to token scale

**Files:**

- Create: `src/components/ui/error-state.tsx`
- Create: `src/components/ui/form-field.tsx`
- Modify: `src/routes/__root.tsx` (use extracted `ErrorState` in `ErrorComponent`/`NotFoundComponent`)
- Modify: `src/components/ui/card.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `sheet.tsx`, `tabs.tsx`, `accordion.tsx`, `switch.tsx`, `badge.tsx`, `label.tsx`, `table.tsx`, `data-table.tsx`, `data-table-column-header.tsx`, `sonner.tsx`, `carousel.tsx`

**Interfaces:**

- Consumes: tokens from Task 1, `Button` from Task 2.
- Produces: `ErrorState` (props: `title`, `description`, `action?`), `FormField` (props: `label`, `htmlFor`, `description?`, `error?`, `children`, `required?`) — used by Tasks 6-8 wherever a form or error boundary appears.

- [ ] **Step 1: `ErrorState`, extracted from `__root.tsx`'s existing `ErrorComponent`/`NotFoundComponent` pattern**

```tsx
// src/components/ui/error-state.tsx
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function ErrorState({ title, description, action, className }: ErrorStateProps) {
  return (
    <div className={cn("flex min-h-screen items-center justify-center bg-canvas px-4", className)}>
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-2 text-sm text-muted">{description}</p> : null}
        {action ? (
          <div className="mt-6">
            <Button onClick={action.onClick}>{action.label}</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewire `__root.tsx` to use it**

Read `src/routes/__root.tsx` `NotFoundComponent` and `ErrorComponent` (shown in full earlier in this session) and replace their JSX bodies with `ErrorState` usage, e.g.:

```tsx
function NotFoundComponent() {
  return (
    <ErrorState
      title="404 — Page not found"
      description="The page you're looking for doesn't exist or has been moved."
      action={{
        label: "Go home",
        onClick: () => {
          window.location.href = "/";
        },
      }}
    />
  );
}
```

Keep `ErrorComponent`'s `router.invalidate()`/`reset()` retry logic — wrap it in the `action.onClick` callback instead of the current inline button. Add the `import { ErrorState } from "@/components/ui/error-state";` import.

- [ ] **Step 3: `FormField` wrapper**

```tsx
// src/components/ui/form-field.tsx
import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface FormFieldProps {
  label: string;
  htmlFor: string;
  description?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  label,
  htmlFor,
  description,
  error,
  required,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {description && !error ? <p className="text-xs text-muted">{description}</p> : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Migrate the 17 remaining `ui/` primitives**

For each file in `card.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `sheet.tsx`, `tabs.tsx`, `accordion.tsx`, `switch.tsx`, `badge.tsx`, `label.tsx`, `table.tsx`, `data-table.tsx`, `data-table-column-header.tsx`, `sonner.tsx`, `carousel.tsx`: read the file, then apply this mapping to any hardcoded/legacy classes found (do not touch files/lines that don't match — this is not a blind replace):

| Find                                                                  | Replace with                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rounded-md` / `rounded-lg` on inputs, selects, buttons-in-primitives | `rounded-control`                                                                                                                                                                                                            |
| `rounded-xl` / `rounded-2xl` on Card root                             | `rounded-card`                                                                                                                                                                                                               |
| `rounded-lg` / `rounded-xl` on Dialog/Sheet/Popover content           | `rounded-overlay`                                                                                                                                                                                                            |
| `rounded-md` on Badge                                                 | `rounded-pill`                                                                                                                                                                                                               |
| `shadow-md`, `shadow-lg`, `shadow-sm` on Card                         | `shadow-paper`                                                                                                                                                                                                               |
| `shadow-lg`, `shadow-xl` on Dialog/Popover/DropdownMenu content       | `shadow-raised`                                                                                                                                                                                                              |
| `bg-white`, `bg-gray-50`                                              | `bg-surface`                                                                                                                                                                                                                 |
| `text-black`, `text-gray-900`                                         | `text-ink`                                                                                                                                                                                                                   |
| `text-gray-500`, `text-gray-600`                                      | `text-muted`                                                                                                                                                                                                                 |
| `border-gray-200`, `border-gray-300`                                  | `border-line`                                                                                                                                                                                                                |
| duration values other than `150`/`200`/`300` on hover/transition      | leave unless clearly arbitrary; do not force `ease-editorial` onto Radix's own open/close animations (those use `tw-animate-css` keyframes and must keep their existing timing to not break Radix's animation-based unmount) |

Give each primitive Sonner's toast styling (`sonner.tsx`) uses tokens too: map its `--normal-bg`/`--normal-border`/`--normal-text` CSS vars (Sonner's own theming API) to `var(--card)`, `var(--border)`, `var(--foreground)` respectively so toasts match the surface system.

- [ ] **Step 5: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 6: Manual check**

`bun run dev` — open a Dialog, a Select, a DropdownMenu, an Accordion, trigger a toast (Sonner) on any page that has one. Confirm radii/shadows look intentional and consistent, dark mode still works.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/ src/routes/__root.tsx
git commit -m "$(cat <<'EOF'
refactor(ui): add ErrorState/FormField primitives, migrate remaining primitives to token scale

Extracts the error/404 boundary in __root.tsx into a reusable
ErrorState component, adds a FormField wrapper for consistent
label/description/error spacing, and migrates the 17 ui/ primitives
still using ad hoc radius/shadow/color classes onto the Task 1 tokens.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Layout & navigation — dark glass nav, active states

**Files:**

- Modify: `src/components/layout/app-shell.tsx`, `desktop-nav.tsx`, `mobile-tab-bar.tsx`, `theme-provider.tsx` (read-only check, no behavior change expected), `theme-toggle.tsx`
- Modify: `src/components/admin/admin-shell.tsx`, `admin-sidebar.tsx`, `admin-header.tsx`

**Interfaces:**

- Consumes: `.mila-dark-glass`, `IconButton` (Task 3), tokens from Task 1.
- Produces: nothing new consumed downstream — this is a leaf visual task.

- [ ] **Step 1: Read each file** to find the current nav-bar container classes (likely already using `atelier-panel`/`backdrop-blur` given the survey found `bg-atelier-panel` in `admin-sidebar.tsx` and `data-table.tsx`) and each active-link class.

- [ ] **Step 2: Apply `.mila-dark-glass`** to the primary floating/sticky nav container(s) in `desktop-nav.tsx` and `mobile-tab-bar.tsx` (replace their current background/blur/border/shadow utility combination with the single class), and to `admin-sidebar.tsx` only if it is genuinely a floating dark surface — if the admin sidebar is a light, non-floating panel (check before changing), leave it on `bg-surface`/`border-line` instead per the spec's rule against glassmorphism on ordinary panels.

- [ ] **Step 3: Nav active states** — ensure the active route link uses one of: `text-accent`, `bg-accent-soft` background, or on `.mila-dark-glass` surfaces a `bg-surface/10 text-surface` tonal state (per spec section 10). Use TanStack Router's `activeProps`/`isActive` render prop (already how the router marks active links — do not change routing behavior, only the className branch).

- [ ] **Step 4: `theme-toggle.tsx`** — migrate its `border-porcelain`/`text-ink` classes to `IconButton` if it's icon-only, adding an accessible `label` prop (e.g. "Toggle theme").

- [ ] **Step 5: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 6: Manual check**

`bun run dev`, check nav on mobile width (375px), tablet (768px), desktop (1280px) — confirm no horizontal overflow, active state visible, theme toggle keyboard-focusable with visible ring.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/ src/components/admin/admin-shell.tsx src/components/admin/admin-sidebar.tsx src/components/admin/admin-header.tsx
git commit -m "$(cat <<'EOF'
style(layout): apply mila-dark-glass nav treatment and unify active states

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Landing/marketing route sweep

**Files:**

- Modify: `src/routes/index.tsx`
- Modify: `src/components/landing/*.tsx` (12 files: `community-section.tsx`, `cta-button.tsx`, `dossier-section.tsx`, `dupe-hunter-section.tsx`, `final-cta-section.tsx`, `hero-section.tsx`, `how-it-works-section.tsx`, `season-tag.tsx`, `testimonials-section.tsx`, and any others in the folder)

**Interfaces:**

- Consumes: `Button`/`buttonVariants` (Task 2), `Container`/`Section`/`SectionHeader` (Task 3), tokens (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: Audit each file** for the section 13 smells: hardcoded hex (grep confirmed none outside color-analysis), `bg-white`, `text-black`, arbitrary `rounded-[...]`, duplicated className strings across sibling sections, inline `style={{}}` used only for color/spacing (grep found ~25 total `style={{` across the repo — check which of those fall in `landing/`).

- [ ] **Step 2: Replace ad hoc section wrappers** with `Container`/`Section`/`SectionHeader` where a file currently hand-rolls `mx-auto max-w-* px-* py-*` — only where the existing markup is a plain layout wrapper, not where it has bespoke structure that would break by extraction.

- [ ] **Step 3: Replace `cta-button.tsx`** internals with `buttonVariants`/`Button` if it's currently a bespoke styled button (check first — if it's a thin wrapper adding tracking-specific behavior, keep the behavior and only fix its visual classes).

- [ ] **Step 4: Motion check** — any Framer Motion usage in `hero-section.tsx`/section reveal animations should use `ease: [0.22, 1, 0.36, 1]` (the `--ease-editorial` curve) and 250-500ms durations, no spring/bounce, respecting `prefers-reduced-motion` (Framer Motion's `useReducedMotion` hook, or leave as-is if the component already conditionally disables motion).

- [ ] **Step 5: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 6: Manual check**

`bun run dev`, visit `/` at 375px/768px/1280px widths, scroll through every section, confirm consistent card radii/shadows, no layout shift, hover states restrained.

- [ ] **Step 7: Commit**

```bash
git add src/routes/index.tsx src/components/landing/
git commit -m "$(cat <<'EOF'
style(landing): migrate marketing page to shared tokens and primitives

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Authenticated app route sweep (dashboard, feed, history, style-profile, login, capture, studio, wardrobe, account)

**Files:**

- Modify: `src/routes/login.tsx`, `src/routes/auth/callback.tsx`, `src/routes/_authenticated.tsx`, `src/routes/_authenticated/_app/dashboard.tsx`, `feed.tsx`, `history.tsx`, `style-profile.tsx`
- Modify: `src/components/login/*.tsx` (4 files), `src/components/dashboard/*.tsx` (5 files), `src/components/feed/*.tsx`, `src/components/capture/*.tsx`, `src/components/studio/*.tsx`, `src/components/style-profile/*.tsx` (5 files, but leave palette-swatch hex values untouched per Global Constraints), `src/components/wardrobe/*.tsx` (leave palette hex untouched), `src/components/account/*.tsx`

**Interfaces:**

- Consumes: everything from Tasks 1-5.
- Produces: nothing downstream.

- [ ] **Step 1-4: same audit/replace/motion pattern as Task 6**, applied per file. Priority fixes flagged by the earlier grep: `studio-membership-drawer.tsx` (30+ `text-stone`/`text-ink`/`border-porcelain` occurrences — these already resolve correctly via Task 1's aliases, so this file needs no forced rename, only a check for `bg-white`/arbitrary radii), `studio-camera-drawer.tsx`, `dual-capture.tsx`, `climate-widget.tsx`, `upgrade-slots-dialog.tsx` (all use `bg-atelier-champagne`/`border-atelier-champagne` — confirm these still resolve after Task 1's `--color-atelier-champagne: var(--accent)` alias, no change needed unless also carrying `rounded-[…]` or `bg-white`).

- [ ] **Step 5: Forms specifically** (`login/*`, any React Hook Form usage in `studio/holistic-profile-form.tsx`, `style-profile/*`) — wrap field groups in `FormField` (Task 4) only where doing so doesn't require restructuring the existing `react-hook-form` `Controller`/`register` wiring; do not touch validation schemas or `zodResolver` calls.

- [ ] **Step 6: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 7: Manual check**

`bun run dev`, walk through `/login`, `/dashboard`, `/feed`, `/history`, `/style-profile` at 375px/768px/1280px, exercise one dialog/drawer per route, confirm forms show visible labels and error states.

- [ ] **Step 8: Commit**

```bash
git add src/routes/login.tsx src/routes/auth/ src/routes/_authenticated.tsx src/routes/_authenticated/_app/ src/components/login/ src/components/dashboard/ src/components/feed/ src/components/capture/ src/components/studio/ src/components/style-profile/ src/components/wardrobe/ src/components/account/
git commit -m "$(cat <<'EOF'
style(app): migrate authenticated app routes to shared tokens and primitives

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Admin route sweep

**Files:**

- Modify: `src/routes/_authenticated/admin.tsx`, `admin/index.tsx`, `admin/members.tsx`, `admin/moderation.tsx`, `admin/support.tsx`
- Modify: `src/components/admin/*.tsx` (7 files: `admin-stat-card.tsx`, `members-columns.tsx`, `support-columns.tsx`, plus `admin-shell.tsx`/`admin-sidebar.tsx`/`admin-header.tsx` already touched in Task 5 — only revisit if new issues found)

**Interfaces:**

- Consumes: everything from Tasks 1-5, especially `data-table.tsx`/`data-table-column-header.tsx` (Task 4) and `Badge`/`Avatar` (Task 3).

- [ ] **Step 1-4: same audit/replace pattern.** Priority: `admin-stat-card.tsx` and the two `*-columns.tsx` files define TanStack Table column definitions — replace any inline badge/status styling with the shared `Badge` component and its variants (add a `success`/`warning`/`destructive` Badge variant in this task if `badge.tsx` doesn't already have one from Task 4 — check first).

- [ ] **Step 2: Table overflow** — confirm `table.tsx` wraps content in a horizontally-scrollable container (`overflow-x-auto`) so admin tables don't cause page-level horizontal overflow on mobile/tablet.

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 4: Manual check**

`bun run dev`, visit `/admin`, `/admin/members`, `/admin/moderation`, `/admin/support` at 375px/768px/1280px, confirm table scrolls horizontally on narrow widths instead of breaking layout, dialogs (member create/edit) open correctly.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/admin.tsx src/routes/_authenticated/admin/ src/components/admin/
git commit -m "$(cat <<'EOF'
style(admin): migrate admin routes and tables to shared tokens and primitives

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Full-repo validation and formatting pass

**Files:** none created/modified beyond formatting.

- [ ] **Step 1: Format all touched files**

```bash
bun run format
git diff --stat
```

Expected: only whitespace/formatting diffs on already-touched files (Prettier should not reformat untouched files unless repo-wide `bun run format` was run — if it touches unrelated files, review the diff before staging and only stage files this refactor actually touched).

- [ ] **Step 2: Full validation suite**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

Expected: all three exit 0.

- [ ] **Step 3: Grep-based completion check**

```bash
grep -rl "bg-white\b" src --include="*.tsx" | grep -v node_modules
grep -rlE "#[0-9a-fA-F]{6}" src --include="*.tsx" | grep -vE "style-profile|wardrobe/DailyPaletteGenerator|color-analysis"
grep -rn "rounded-\[" src --include="*.tsx"
```

Expected: the `bg-white` and stray-hex lists are empty or down to justified exceptions noted in the final report; `rounded-[...]` count matches the 2 pre-existing occurrences noted in the design doc unless deliberately resolved.

- [ ] **Step 4: Commit** (only if Step 1 produced a diff)

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: format design-system refactor with project formatter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
