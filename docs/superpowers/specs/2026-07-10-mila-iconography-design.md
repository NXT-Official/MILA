# Mila Iconography Pass — Design

## Context

The warm-editorial design-system refactor is complete (tokens, primitives, sitewide token migration — see `2026-07-10-mila-design-system-design.md`). This is a narrower follow-up: add consistent Lucide icons where they aid recognition/navigation, standardize sizes and stroke widths, and consolidate duplicated icon markup into shared components.

Survey findings: 49 files already import from `lucide-react` (~60 distinct icons). Several primitives built in the design-system pass already partially satisfy this spec (`Button`'s `[&_svg]:size-4` global sizing, `DataTableColumnHeader`'s sort icons, `EmptyState`/`LoadingState`). The gap is real but narrower than the spec's full checklist once filtered against what actually exists in the app.

## Explicitly out of scope (features that don't exist)

- Sidebar search input / `SearchInput` component — admin sidebar has 4 static links, no search feature.
- Settings navigation — no settings route exists.
- Admin top-bar notifications/help/user-menu — none of these features exist; only a sidebar-toggle (mobile) and theme toggle exist in the top bar today.
- `UploadField` / drag-and-drop upload zone — the app uses camera-capture flows (`Camera`/`Images` icons already applied), not file dropzones.
- `TableActionMenu`, `StatusMessage` shared components — each would have exactly one real call site; not enough repetition to justify a new abstraction (YAGNI).
- `AppIcon` wrapper — `Button`/`IconButton` already own icon sizing via CSS; free-standing icons need genuinely different per-context sizes (sidebar 18px, dense-table 14px, empty-state 24px), so a generic wrapper adds indirection without consolidating anything real.

## In scope

1. **`Input` component**: add `leadingIcon?: LucideIcon`, `trailingIcon?: LucideIcon`, `trailingElement?: React.ReactNode` props per the spec's recommended API. Apply `leadingIcon={Search}` to `DataTable`'s existing search field.
2. **`PasswordVisibilityButton`**: new shared component (`Eye`/`EyeOff`, `aria-pressed`, `aria-label`). Replaces duplicated inline toggle markup in `login-form.tsx` and `signup-form.tsx`.
3. **Admin sidebar** (`admin-sidebar.tsx`): icons `h-3.5 w-3.5`/`strokeWidth={1.5}` → `size-[18px]`/`strokeWidth={1.75}`; type `ADMIN_LINKS` icon field as `LucideIcon`; add `aria-current="page"` to the active link (currently color-only); swap `LayoutGrid` → `LayoutDashboard` for the Dashboard item (more literal match). Active-state background treatment (`bg-ink text-background`) is kept — that's an established, non-color-only visual (pill shape + weight), not part of this pass's scope to redesign.
4. **Admin header** (`admin-header.tsx`): mobile sidebar-toggle button swaps `Menu`↔`X` based on `sidebarOpen`, with a matching `aria-label`/`aria-expanded` update (currently only ever shows `Menu`, giving no open/close feedback).
5. **`DataTable`**: leading `Search` icon on the filter input; `ChevronLeft`/`ChevronRight` added to the existing Previous/Next buttons (no new First/Last buttons — that would be a UI addition beyond "add an icon to what's there"); small muted icon added to the empty-row state; sort icons (already correct: `ArrowUp`/`ArrowDown`/`ArrowUpDown` at `size-3.5`) get explicit `strokeWidth={1.75}`.
6. **`members-columns.tsx`**: `MoreHorizontal` → `Ellipsis` (spec's preferred name for the row-actions trigger; same glyph, consistency win). Dropdown items already use appropriate icons (`Pencil`, `UserCheck`, `UserX`) — no change.
7. **Micro empty-states**: dashboard's "No members yet." / "No activity yet." and moderation's "No posts to moderate." captions get a small inline muted icon (not the full `EmptyState` card treatment — these are compact widget captions, and a full padded empty-state card would look oversized inside them, which the spec itself warns against).
8. **Site-wide normalization**: mechanical, safe substitutions across all Lucide-importing files —
   - `h-N w-N` (matching values) → `size-N` Tailwind v4 utility
   - `strokeWidth={1.5}` → `strokeWidth={1.75}`; icons with no explicit `strokeWidth` get `strokeWidth={1.75}` added where touched
   - Leave `strokeWidth={2}` (Lucide's default, i.e. wherever no prop is set and the icon is inside a dense/small control that's staying untouched) alone unless the file is already being edited for another reason in this pass — no blind sweep of every untouched file purely for stroke-width parity
   - Keep `Loader2` as the established loading-spinner icon site-wide rather than introducing `LoaderCircle` as a second "same meaning, different name" icon — they render nearly identically and `Loader2` is already used consistently in ~8 places

## Icon choices deviating from the spec's suggested table (with reason)

- Loading indicator: `Loader2` (kept) instead of `LoaderCircle` — avoids two icons meaning the same thing in one codebase.
- Row-actions trigger: `Ellipsis` (spec's own preferred name) instead of the currently-used `MoreHorizontal`.

## Validation

`bun run format`, `bun run lint`, `bunx tsc --noEmit`, `bun run build` — same as the design-system pass. No test runner configured in this repo.
