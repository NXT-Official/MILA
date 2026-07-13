# Mila Iconography Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consistent Lucide icons across the admin sidebar/header, data table, forms, and empty states; consolidate duplicated icon markup (password toggle) into shared components; normalize icon sizes and stroke widths sitewide — without adding new dependencies, features, or touching application/auth/routing logic.

**Architecture:** Extend the existing `Input` primitive with optional icon props rather than building a parallel `SearchInput` component. Add one new shared component (`PasswordVisibilityButton`) for a pattern already duplicated twice. Everything else is targeted edits to existing files (`admin-sidebar.tsx`, `admin-header.tsx`, `data-table.tsx`, `members-columns.tsx`) plus a mechanical, grep-driven size/stroke-width normalization pass across the ~49 files already importing from `lucide-react`.

**Tech Stack:** React 19, TypeScript, Tailwind v4, `lucide-react` (already installed, no new icon library), Radix UI, CVA, `cn()` at `src/lib/utils.ts`. No test runner — verification is `bunx tsc --noEmit`, `bun run lint`, `bun run build`, `bun run format`.

## Global Constraints

- No new dependencies. Do not add another icon library.
- Do not invent UI for features that don't exist (sidebar search, settings nav, top-bar notifications/help, upload dropzone) — see design spec `docs/superpowers/specs/2026-07-10-mila-iconography-design.md` for the full exclusion list and reasoning.
- Icon size tiers: `size-3.5` (dense table/metadata), `size-4` (inputs/compact controls/dropdown items), `size-[18px]` (sidebar/nav), `size-5` (standard buttons/mobile nav), `size-6` (empty-state icons), `size-8`+ (intentional illustrations only).
- Default `strokeWidth={1.75}`; `strokeWidth={2}` only for deliberate emphasis (none identified as needed in this pass).
- Keep `Loader2` as the sitewide loading icon (not `LoaderCircle` — avoid two icons meaning the same thing).
- Decorative icons: `aria-hidden="true"`. Icon-only controls: `aria-label`. Never attach click handlers to `<svg>`/icon elements directly — always wrap in a real `<button>`.
- `cn()` is canonical; do not create another.
- Commit after each task on `main`.

---

### Task 1: `Input` leading/trailing icon support + `PasswordVisibilityButton`

**Files:**

- Modify: `src/components/ui/input.tsx`
- Create: `src/components/ui/password-visibility-button.tsx`
- Modify: `src/components/login/login-form.tsx`
- Modify: `src/components/login/signup-form.tsx`

**Interfaces:**

- Produces: `Input` gains `leadingIcon?: LucideIcon`, `trailingIcon?: LucideIcon`, `trailingElement?: React.ReactNode` props (all optional, none change existing call sites' behavior). `PasswordVisibilityButton` component: props `{ visible: boolean; onToggle: () => void; className?: string }`.
- Consumes: `cn` from `@/lib/utils`, `LucideIcon` type from `lucide-react`.

- [ ] **Step 1: Extend `Input`**

Current file (`src/components/ui/input.tsx`) is a plain forwardRef wrapping a single `<input>`. Replace with:

```tsx
import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.ComponentProps<"input"> {
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
  trailingElement?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      leadingIcon: LeadingIcon,
      trailingIcon: TrailingIcon,
      trailingElement,
      ...props
    },
    ref,
  ) => {
    const hasTrailing = Boolean(TrailingIcon || trailingElement);

    if (!LeadingIcon && !hasTrailing) {
      return (
        <input
          type={type}
          className={cn(
            "mila-focus-ring flex h-11 w-full rounded-control border border-line bg-surface px-3.5 py-1 text-base text-ink transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className,
          )}
          ref={ref}
          {...props}
        />
      );
    }

    return (
      <div className="relative">
        {LeadingIcon ? (
          <LeadingIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
            strokeWidth={1.75}
          />
        ) : null}
        <input
          type={type}
          className={cn(
            "mila-focus-ring flex h-11 w-full rounded-control border border-line bg-surface px-3.5 py-1 text-base text-ink transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            LeadingIcon && "pl-10",
            hasTrailing && "pr-10",
            className,
          )}
          ref={ref}
          {...props}
        />
        {TrailingIcon ? (
          <TrailingIcon
            aria-hidden="true"
            className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
            strokeWidth={1.75}
          />
        ) : null}
        {trailingElement ? (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailingElement}</div>
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
```

(The no-icon early-return keeps every existing call site — which is most of them — byte-for-byte unchanged in output.)

- [ ] **Step 2: `PasswordVisibilityButton`**

```tsx
// src/components/ui/password-visibility-button.tsx
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PasswordVisibilityButtonProps {
  visible: boolean;
  onToggle: () => void;
  className?: string;
}

export function PasswordVisibilityButton({
  visible,
  onToggle,
  className,
}: PasswordVisibilityButtonProps) {
  return (
    <button
      type="button"
      aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible}
      onClick={onToggle}
      className={cn(
        "absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-control text-muted transition-colors hover:bg-accent-soft hover:text-ink mila-focus-ring",
        className,
      )}
    >
      {visible ? (
        <EyeOff aria-hidden="true" className="size-4" strokeWidth={1.75} />
      ) : (
        <Eye aria-hidden="true" className="size-4" strokeWidth={1.75} />
      )}
    </button>
  );
}
```

- [ ] **Step 3: Wire into `login-form.tsx`**

Replace the imports `Eye, EyeOff` (keep `ArrowRight`) and the inline `<button>...</button>` block (lines ~101-108) with:

```tsx
import { PasswordVisibilityButton } from "@/components/ui/password-visibility-button";
// ...
<PasswordVisibilityButton visible={showPassword} onToggle={onToggleShowPassword} />;
```

- [ ] **Step 4: Wire into `signup-form.tsx`**

Same replacement (keep `ArrowRight, Check, X`, drop `Eye, EyeOff` from the import, add the `PasswordVisibilityButton` import and swap the inline button block ~lines 147-154).

- [ ] **Step 5: Verify**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: no errors. `tsc` will catch it if any other call site was relying on `Input`'s old non-generic prop shape (none should be, since `InputProps` is a strict superset of the previous `React.ComponentProps<"input">`).

- [ ] **Step 6: Manual check**

`bun run dev`, visit `/login`, toggle password visibility on both the Log In and Sign Up tabs — confirm identical behavior to before, visible focus ring, correct icon swap.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/input.tsx src/components/ui/password-visibility-button.tsx src/components/login/login-form.tsx src/components/login/signup-form.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add Input leading/trailing icon support and PasswordVisibilityButton

Input's no-icon path is unchanged output, so the ~40 existing call
sites are unaffected. Replaces the identical password-toggle button
markup duplicated in login-form and signup-form.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Admin sidebar icon and accessibility fixes

**Files:**

- Modify: `src/components/admin/admin-sidebar.tsx`

**Interfaces:**

- Consumes: `Input` unchanged; no new consumers.

- [ ] **Step 1: Type the nav config and swap the Dashboard icon**

```tsx
import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Users, ShieldAlert, LifeBuoy, LogOut, Loader2 } from "lucide-react";

interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const ADMIN_LINKS: AdminNavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/members", label: "Members", icon: Users },
  { to: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
  { to: "/admin/support", label: "Support", icon: LifeBuoy },
];
```

- [ ] **Step 2: Update icon size/stroke and add `aria-current`**

In the `.map()` over `ADMIN_LINKS`, change:

```tsx
<Link
  key={to}
  to={to}
  onClick={() => onNavigate?.()}
  aria-current={active ? "page" : undefined}
  className={cn(
    "flex items-center gap-2.5 rounded-full px-4 py-2.5 text-[10px] uppercase tracking-[0.22em] transition-colors",
    active ? "bg-ink text-background" : "text-stone hover:text-ink hover:bg-background/60",
  )}
>
  <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
  {label}
</Link>
```

(Only additions: `aria-current`, `Icon` size/stroke, `aria-hidden`, `shrink-0` — the active/inactive background treatment is unchanged.)

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
bun run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/admin-sidebar.tsx
git commit -m "$(cat <<'EOF'
style(admin): fix sidebar icon sizing and add aria-current to active nav item

Icons were h-3.5/strokeWidth 1.5, now size-[18px]/1.75 per the icon
size system. Active route was previously distinguished by color
alone; aria-current="page" now marks it for assistive tech.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Admin header mobile toggle Menu/X swap

**Files:**

- Modify: `src/components/admin/admin-header.tsx`

- [ ] **Step 1: Swap the icon and label based on `sidebarOpen`**

Read the file first (`onOpenSidebar`/`sidebarOpen` props already exist per `admin-shell.tsx`'s usage). Replace the `Menu`-only import and button body:

```tsx
import { Menu, X } from "lucide-react";
// ...
<button
  type="button"
  onClick={onOpenSidebar}
  aria-label={sidebarOpen ? "Close admin navigation" : "Open admin navigation"}
  aria-expanded={sidebarOpen}
  className="lg:hidden inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-porcelain/60 bg-background/60 text-ink hover:border-porcelain transition-colors"
>
  {sidebarOpen ? (
    <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
  ) : (
    <Menu className="size-4" strokeWidth={1.75} aria-hidden="true" />
  )}
</button>;
```

Note: `onOpenSidebar` only opens today (per `AdminShell`, closing happens via backdrop click or Escape) — this step only changes the icon/label to reflect state, it does not add new close-click behavior, since that would be a logic change outside this pass's scope. If `onOpenSidebar` unconditionally sets `sidebarOpen(true)`, clicking while open is a no-op, which matches current behavior (button was previously always `Menu` regardless of state, so this is a pure visual/accessibility improvement, not a regression).

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
bun run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/admin-header.tsx
git commit -m "$(cat <<'EOF'
style(admin): swap Menu/X icon on mobile sidebar toggle based on open state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `DataTable` search icon, pagination icons, empty-state icon

**Files:**

- Modify: `src/components/ui/data-table.tsx`
- Modify: `src/components/ui/data-table-column-header.tsx`

- [ ] **Step 1: Search input leading icon**

In `data-table.tsx`, import `Search, ChevronLeft, ChevronRight, Inbox` from `lucide-react`, and change the search `<Input>`:

```tsx
<Input
  leadingIcon={Search}
  value={globalFilter}
  onChange={(e) => setGlobalFilter(e.target.value)}
  placeholder={searchPlaceholder}
  className="max-w-sm bg-background border-porcelain/60 rounded-full text-sm"
/>
```

- [ ] **Step 2: Pagination icons**

```tsx
<Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
  <ChevronLeft aria-hidden="true" />
  Previous
</Button>
<Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
  Next
  <ChevronRight aria-hidden="true" />
</Button>
```

(`Button`'s own `[&_svg]:size-4` handles sizing — no manual className needed.)

- [ ] **Step 3: Empty-row icon**

Change the empty `TableCell` body to:

```tsx
<TableCell colSpan={columns.length} className="h-32 text-center text-sm text-stone">
  <div className="flex flex-col items-center gap-2">
    <Inbox className="size-6 text-muted" strokeWidth={1.75} aria-hidden="true" />
    {emptyMessage}
  </div>
</TableCell>
```

(Only the empty-results branch — leave the `isLoading` branch's plain "Loading…" text as-is, a spinner there is a separate, larger change not required by this pass.)

- [ ] **Step 4: Sort icon stroke width**

In `data-table-column-header.tsx`, add `strokeWidth={1.75}` to the existing `ArrowUp`/`ArrowDown`/`ArrowUpDown` elements (read the file first — sizes are already `size-3.5`/`h-3.5 w-3.5`, only the stroke width is missing).

- [ ] **Step 5: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 6: Manual check**

`bun run dev`, visit `/admin/members`, confirm search icon doesn't overlap typed text, Previous/Next show chevrons without wrapping, trigger an empty search to see the `Inbox` icon.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/data-table.tsx src/components/ui/data-table-column-header.tsx
git commit -m "$(cat <<'EOF'
style(ui): add search/pagination/empty-state icons to DataTable

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Admin table action icon consistency + micro empty-state icons

**Files:**

- Modify: `src/components/admin/members-columns.tsx`
- Modify: `src/routes/_authenticated/admin/index.tsx`
- Modify: `src/routes/_authenticated/admin/moderation.tsx`

- [ ] **Step 1: `Ellipsis` instead of `MoreHorizontal`**

In `members-columns.tsx`, change the import and the row-actions trigger icon from `MoreHorizontal` to `Ellipsis` (same glyph, spec's preferred name — one-line rename in both the import and JSX usage).

- [ ] **Step 2: Micro empty-state icons in `admin/index.tsx`**

Read the file first (`"No members yet."` / `"No activity yet."` blocks). Import `Users, Inbox` from `lucide-react` (or reuse an already-imported icon if contextually apt) and prefix each caption:

```tsx
<div className="px-5 py-8 text-center text-sm text-stone flex flex-col items-center gap-2">
  <Users className="size-5 text-muted" strokeWidth={1.75} aria-hidden="true" />
  No members yet.
</div>
```

```tsx
<div className="px-5 py-8 text-center text-sm text-stone flex flex-col items-center gap-2">
  <Inbox className="size-5 text-muted" strokeWidth={1.75} aria-hidden="true" />
  No activity yet.
</div>
```

- [ ] **Step 3: Micro empty-state icon in `moderation.tsx`**

Read the file first (`"No posts to moderate."` block, currently a single-line centered caption). Add an `Inbox` (or `ShieldAlert`-adjacent — use judgment once the surrounding copy is visible) icon above it in the same compact style as Step 2.

- [ ] **Step 4: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/members-columns.tsx src/routes/_authenticated/admin/index.tsx src/routes/_authenticated/admin/moderation.tsx
git commit -m "$(cat <<'EOF'
style(admin): Ellipsis row-actions icon, small icons on micro empty-states

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Site-wide icon size/stroke-width normalization

**Files:** any `.tsx` file matching `grep -rl "from \"lucide-react\"" src` not already touched in Tasks 1-5 where a normalizable pattern is found — determined by the audit commands below, not pre-enumerated (mechanical sweep, not a rewrite).

- [ ] **Step 1: Find exact-match `h-N w-N` size pairs used on Lucide icon elements**

```bash
grep -rnoE 'className="[^"]*\bh-3\.5 w-3\.5\b[^"]*"' src --include="*.tsx"
grep -rnoE 'className="[^"]*\bh-4 w-4\b[^"]*"' src --include="*.tsx"
grep -rnoE 'className="[^"]*\bh-5 w-5\b[^"]*"' src --include="*.tsx"
grep -rnoE 'className="[^"]*\bh-3 w-3\b[^"]*"' src --include="*.tsx"
```

For each match inside a Lucide-icon-element className (not an unrelated element — check context), replace `h-N w-N` with `size-N` in that exact className string. `h-3 w-3` (12px, not one of the spec's tiers) → round up to `size-3.5` (nearest tier) only where it's a Lucide icon.

- [ ] **Step 2: Add/normalize `strokeWidth`**

```bash
grep -rn "strokeWidth={1.5}" src --include="*.tsx"
```

Change each to `strokeWidth={1.75}`. Then, for icon elements touched in Step 1 (i.e. already being edited on that line) that have no `strokeWidth` prop at all, add `strokeWidth={1.75}`. Do not touch `strokeWidth` on lines/files not already being edited in Step 1 — this avoids a blind whole-repo sweep of icons this task isn't otherwise looking at.

- [ ] **Step 3: Remove unused imports**

```bash
bunx eslint . --quiet 2>&1 | grep -i "no-unused-vars\|is defined but never used"
```

Fix any `lucide-react` imports left unused by Tasks 1-6's edits (e.g. `MoreHorizontal` in `members-columns.tsx` from Task 5, or `Eye`/`EyeOff` in `login-form.tsx`/`signup-form.tsx` from Task 1 if not already cleaned up).

- [ ] **Step 4: Verify**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

- [ ] **Step 5: Manual check**

`bun run dev`, spot-check 3-4 pages across mobile/desktop (landing hero, dashboard, admin sidebar, a dialog) — confirm no icon looks visually different in a way that breaks alignment (this task should be purely a unit-normalization, e.g. `h-4 w-4` and `size-4` render identically; the only visible changes are the `strokeWidth` 1.5→1.75 tweaks, which are subtle).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
style: normalize icon sizing (h-N w-N -> size-N) and stroke widths sitewide

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Final validation and formatting pass

- [ ] **Step 1: Format**

```bash
bun run format
git status --short
```

Review the diff — stage only files this pass actually touched (same caution as the design-system pass: `bun run format` can reformat unrelated files if run repo-wide; revert anything outside `src/` or the two spec/plan docs).

- [ ] **Step 2: Full validation**

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

Expected: all exit 0, 11 pre-existing fast-refresh warnings only (no new errors).

- [ ] **Step 3: Grep-based completion check**

```bash
grep -rln "MoreHorizontal" src --include="*.tsx"
grep -rn "strokeWidth={1.5}" src --include="*.tsx"
grep -rln "import \* as [A-Za-z]* from \"lucide-react\"" src --include="*.tsx"
```

Expected: `MoreHorizontal` gone from `members-columns.tsx` (other files may legitimately still use it if not touched), no remaining `strokeWidth={1.5}`, no wildcard `lucide-react` imports anywhere (there shouldn't be any — confirms the "no full-namespace import" rule was never violated).

- [ ] **Step 4: Commit** (only if Step 1 produced a diff)

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: format iconography pass

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
