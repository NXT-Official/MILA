## Goal

Reshape the Studio page into an editorial "Digital Style Dossier" with a perspective switcher, accordion-grouped Detailed view, pill-based archetype selectors, beauty-preference tags, and frictionless auto-save — without disturbing the existing AI camera, calibration, or quiz subsystems already shipping inside this 2,500-line route.

## Scope (in)

`src/routes/_authenticated/style-profile.tsx` — replace the visible profile selectors and surrounding layout. Add small presentational helpers inside the same file.

Add `beauty_preferences` to the `profiles` row via a migration (JSONB, default `[]`), so the new pill tray persists.

## Scope (out)

- Camera capture, AI Vision calibration, manual-calibration sheet, quiz sheets, ColorDossierSection, and HolisticProfileForm internals all remain functionally intact — only their wrappers and the surrounding shell change.
- Dashboard, Feed, Lens, Concierge — untouched.

## New UI

```text
┌──────────────────────────────────────────────────────────┐
│  STUDIO · DIGITAL STYLE DOSSIER         DOSSIER SYNCED ◦ │
│                                                          │
│  ╭──────────────────────────────────────────╮            │
│  │  [ STREAMLINED ]  ·  [ DETAILED DOSSIER ]│  ← glass    │
│  ╰──────────────────────────────────────────╯            │
│                                                          │
│  ── Streamlined ────────────────────────────────────────  │
│  Color Season   · pill row (4 seasons + sub-season hint)  │
│  Body Type      · pill row (5 silhouettes)                │
│  Hair Type      · pill row                                │
│                                                          │
│  ── Detailed Dossier (accordion) ───────────────────────  │
│  ▸ 01 / THE PALETTE BASELINE   — Season · Undertone      │
│  ▸ 02 / ARCHITECTURAL FRAME    — Body · Face shape       │
│  ▸ 03 / BEAUTY & TEXTURE       — Hair · Beauty pill tray │
└──────────────────────────────────────────────────────────┘
```

- **Switcher**: glassmorphic pill (`backdrop-blur-xl`, `bg-white/40`, hairline `border-atelier-ink/10`) with two tracking-widest labels. Active label gets a solid `bg-atelier-ink text-atelier-bone` sliding indicator (framer-motion `layoutId`).
- **Selectors**: replace the current Select dropdowns for season / body / undertone / face / hair with horizontal pill rows (overflow-x-auto on mobile). Active = `bg-atelier-champagne/15`, `border-atelier-ink`, tiny `Check` glyph. Idle = `text-atelier-stone`, `border-atelier-stone/20`.
- **Beauty preferences**: tap-to-toggle floating pill badges from a curated list — Dewy Base, Monochromatic Peach, Minimalist, Bold Lip, Blurred Velvet Finish, Glass Skin, Soft Smoke, Editorial Brow, Lacquered Lash, Skin-First.
- **Section headings**: `font-display` (Playfair Display) uppercase + tracked, with one-line editorial micro-copy below.
- **Sync indicator**: fixed top-right chip — "DOSSIER SYNCED" steady, "SYNCING…" while a debounce flushes, "SYNC PAUSED" on error. Tracking-widest, micro caps.

## Auto-save

- Single `useEffect` watches `form`, `holistic`, and `beautyPreferences`.
- Debounce 600 ms → `supabase.from("profiles").update(...).eq("id", user.id)`.
- On success: set status `synced`, invalidate `["profile", user.id]` and `["dailyLook"]` query keys.
- Remove the visible "Save" button. Keep the existing camera/quiz CTA buttons.

## Data layer

Migration `add_beauty_preferences_to_profiles`:

```sql
alter table public.profiles
  add column if not exists beauty_preferences jsonb not null default '[]'::jsonb;
```

No new RLS — existing profile policies cover it. No new GRANTs (column on existing table).

Load: extend the existing profile fetch to read `beauty_preferences` into local state.
Save: include `beauty_preferences` in the debounced update payload.

## Implementation steps

1. Migration — add `beauty_preferences jsonb default '[]'` to `profiles`.
2. Inside `StyleProfile()`:
   - new state: `viewMode: "streamlined" | "detailed"`, `beautyPreferences: string[]`, `syncStatus: "idle" | "syncing" | "synced" | "error"`.
   - load `beauty_preferences` from existing profile select.
   - debounced auto-save effect; remove the existing manual Save button + its onClick handler (or repurpose as a no-op fallback only if it's wired to a non-form action like recalibration — verify by reading 523–880 first).
3. Add presentational helpers in the same file: `PillRow`, `BeautyPillTray`, `SyncBadge`, `PerspectiveSwitcher`, `SectionHeader`.
4. Rewrite the JSX return for the profile-fields region only. Keep `<ColorDossierSection />`, `<HolisticProfileForm />` (its internal selects get hidden behind the new pill rows — pass values + onChange instead), camera/quiz sheets, telemetry, and manual-calibration sheet exactly as today.
5. Verify `bunx tsc --noEmit` passes.

## Open question

The current `HolisticProfileForm` owns face-shape + hair-type selects internally. Two options:

- **A (preferred)**: lift its state up — render new pill rows directly in the route and stop rendering `HolisticProfileForm`'s selects (keep the component file but bypass its UI). Faster, cleaner visuals.
- **B**: edit `HolisticProfileForm` to expose pill UI itself.

I'll go with **A** unless you'd prefer to keep the form component as the source of truth.
