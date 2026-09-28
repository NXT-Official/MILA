# Gender Guardrails + Restart Style Analysis — Design

**Date:** 2026-09-28
**Status:** Approved, pending implementation plan
**Scope:** Item #5 (gender-mixing bug + easy restart) and item #1 (redo fashion profile scan) from the 2026-09-28 UX feedback batch. These two items turned out to be the same underlying gap and are handled together.

## Problem

1. Users with `gender = "Non-binary"` or `"Prefer not to say"` get shopping picks pulled from the entire product catalog with no gender filtering, so a single generated look can mix menswear and womenswear items. Confirmed root cause: `isGenderMatch` in `src/lib/look-products.functions.ts` only filters when `gender` is `"Male"` or `"Female"`; for the other two values `matchLookProducts` passes `gender: undefined`, which is treated as "don't filter."
2. There is no discoverable way to redo the guided style-profile scan (gender, body type, color season, etc.) once onboarding is complete. `quizOpen` / `bodyQuizOpen` state in `src/components/style-profile/style-profile-page.tsx` is set but never triggered by any UI element — `ColorQuiz` and `BodyTypeQuiz` are unreachable dead code. The onboarding wizard route (`/onboarding/style-profile`) has no guard preventing revisits and already supports full redo via `ReviewStep.onEdit`, but nothing in the app links to it after first completion.

## Catalog data (confirmed via direct query, 2026-09-28)

In-stock products by gender: Female 488, Male 270, Unisex 95.
Unisex breakdown by category: Jewelry 29, Bags 22, Accessories 15, Outerwear 11, Tops 11, Shoes 5, Bottoms 2.

A pure "Unisex only" filter for Non-binary/Prefer-not-to-say users would leave Bottoms and Shoes almost empty, causing those categories to be silently omitted from nearly every generated look (per the existing "skip a category entirely if nothing suits" rule in `look.ts`'s system prompt). This motivates the hybrid approach below rather than a straight Unisex-only filter.

## Part 1 — Shoppable-picks gender guardrail

**File: `src/lib/look-products.functions.ts`**

- `matchLookProducts` gains two-pass candidate selection per category when `gender` is `"Non-binary"`, `"Prefer not to say"`, or omitted:
  - Pass 1: existing `isGenderMatch` logic, but restricted to `product.gender === "Unisex"` only.
  - Pass 2 (fallback, only if Pass 1 returns zero candidates for that category): include Male + Female candidates for that category, each retaining its `gender` field (currently stripped out in the returned `LookProduct` type — this field must now flow through for fallback-sourced items so the AI can see which direction each item belongs to).
- `LookProduct` type gains an optional `gender?: string` field, populated only for fallback-sourced items (omit/leave undefined for Unisex-sourced items and for Male/Female-profile lookups, to avoid changing the prompt shape for the unaffected majority of users).

**File: `src/lib/generate-outfit.functions.ts`** (or wherever `DailyLookSchema` / `buildDailyLookTool` are defined)

- Add optional field to the tool schema and `DailyLook` type: `fallback_gender_direction: "Masculine" | "Feminine" | null`. Required-when-used: the AI must set this whenever it selects any fallback-sourced (non-Unisex) item; null/omitted otherwise.

**File: `src/server/services/look.ts`**

- System prompt: candidate list formatting includes the gender tag for fallback-sourced items only, e.g. `- id="..." | Bottoms | Wide-Leg Trouser | $120 USD | (Masculine)`. Unisex items and items for Male/Female-profile users show no tag (unchanged format).
- New system prompt rule (only rendered when any fallback candidates are present in the list): "Some Bottoms/Shoes items above are tagged (Masculine) or (Feminine) because Unisex options are limited. If you use any of these, you MUST pick from only ONE of those two tags for the entire look, and set `fallback_gender_direction` accordingly. Never combine a (Masculine) and a (Feminine) tagged item in the same look. Unisex-tagged items (no label) may always be combined with either direction."
- After `hydrateShoppablePicks`, add a hard server-side filter: if `fallback_gender_direction` is set, drop any hydrated pick whose source category was a fallback-pass item with a gender not matching the declared direction (re-derive this from the candidate list already in scope — don't trust the model's `rationale` text). If `fallback_gender_direction` is null but the model picked a fallback item anyway, drop that pick (fail closed, not open). Log a warning when picks are dropped this way, same pattern as the existing schema-rejection logging in this file.

## Part 2 — Image generation direction consistency

**File: `src/lib/openrouter-image.server.ts`**

- `generateOutfitImage` and `buildOutfitImagePrompt` gain an optional `fallbackGenderDirection?: "Masculine" | "Feminine" | null` parameter.
- `genderLine` logic: if `gender` is Male/Female, unchanged (existing behavior). If `gender` is Non-binary/Prefer-not-to-say/null AND `fallbackGenderDirection` is set, use it for the presentation line ("presenting as masculine" / "presenting as feminine"). If neither is set, unchanged (no gender line — model renders neutrally).

**File: `src/server/services/look.ts`** (`renderLookImageForUser`)

- Pass `data.fallback_gender_direction` through to `generateOutfitImage`'s deps object.

## Part 3 — Restart Style Analysis

**File: `src/components/style-profile/style-profile-page.tsx`**

- Add a "Restart Style Analysis" button in the page header, next to `SyncBadge`.
- Clicking opens a confirm dialog (reuse the app's existing `AlertDialog` component): "This walks you back through your full style profile, including gender and body type. Your current profile stays until you save changes." Confirm navigates to `/onboarding/style-profile` (no `step` param, so it resolves via `getFirstIncompleteOnboardingStep` — since the profile is complete, this lands on `review`, from which every field is individually editable via `ReviewStep.onEdit`). Cancel closes the dialog, no navigation.
- Remove dead state and now-unreachable components: `quizOpen`, `bodyQuizOpen`, the `ColorQuiz` and `BodyTypeQuiz` imports and their conditional render blocks. The color-camera re-scan entry point ("Open the camera" → `VisualDiagnosticViewfinder`) and inline pill editing remain unchanged — this only removes the two dead quiz modals that had no way to open.

## Out of scope (flagged, not solved here)

- Non-binary/Prefer-not-to-say outfit *text* (hair/makeup rationale) already says "favor gender-neutral/androgynous silhouettes" in `profileLines` — this may read slightly inconsistent with a `fallback_gender_direction`-influenced shopping pick (e.g. androgynous copy next to a Masculine-tagged trouser). Not the reported bug; not addressed in this pass.
- Backfilling the product catalog with more Unisex-tagged items (would reduce reliance on the fallback path) is a content/ops task, not a code change.

## Testing

- Unit tests for `isGenderMatch`/two-pass selection in `look-products.functions.ts` (existing test file pattern in this repo — check for a co-located `.test.ts`).
- Unit test for the hard server-side fallback-direction filter in `look.ts` (drop-mismatch and fail-closed-when-null cases).
- Component/interaction test for the Restart Style Analysis confirm dialog and navigation.
