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

## Correction (2026-09-28, before implementation)

The section below was originally written against a stale read of `look.ts` / `look-products.functions.ts`. The real live pipeline is a 4-step process (`loadLookInventory` → inventory-review AI call → outfit-plan AI call → `pickSimilarAdditions`), not the single-call `matchLookProducts` path this section originally targeted (`matchLookProducts` is dead code — nothing in the live pipeline calls it). Part 1 and Part 2 below are the corrected design, approved in place of the original AI-declares-direction approach. Part 3 is unaffected.

## Part 1 — Shoppable-picks gender guardrail (server-decided-once direction)

**File: `src/lib/look-products.functions.ts`**

- `Input`/`LookProductsInput` gains an optional field: `fallbackDirection: z.enum(["Male", "Female"]).optional()`.
- `isGenderMatch(productGender, requestedGender?, fallbackDirection?)`: unchanged when `requestedGender` is set (Male/Female profile, exact match or Unisex). When `requestedGender` is absent and `fallbackDirection` is set, matches `productGender === "Unisex" || productGender === fallbackDirection`. When both are absent, unchanged "match everything" behavior — preserves `matchLookProducts`'s existing behavior and tests, since it never supplies `fallbackDirection`.
- `fetchRankedCategory` and `loadLookInventory` thread `fallbackDirection` through from their `LookProductsInput` param into the one `isGenderMatch` call.

**File: `src/server/services/look.ts`**

- Where `productGenderFilter` is computed (ambiguous gender collapses to `undefined`), add: `const fallbackGenderDirection: "Male" | "Female" | null = productGenderFilter ? null : (Math.random() < 0.5 ? "Male" : "Female");` — decided once, before `loadLookInventory` runs.
- Pass `fallbackDirection: fallbackGenderDirection ?? undefined` into the `loadLookInventory` call.
- Because this happens before step 1, the inventory-review AI call, the outfit-plan AI call, and `pickSimilarAdditions` (which filters the same already-loaded `inventory` array) are all automatically gender-consistent — no changes needed to any of those three, no new tool-schema fields, no AI-declared value to verify after the fact.
- Inject `fallback_gender_direction: fallbackGenderDirection` into `argsWithMakeup` — server-set, never model-authored, same pattern as the existing `forecastRetrievedAt` field.

**File: `src/lib/generate-outfit.functions.ts`**

- `DailyLookSchema` gains `fallback_gender_direction: z.enum(["Male", "Female"]).nullable().optional()` (optional so a look persisted before this change still validates).

This is simpler than the original design: no tool-schema changes, no system-prompt guardrail paragraph, no post-hoc hydration filter. The catalog itself never contains a gender mix for an ambiguous profile, so there's nothing to verify or trust after the fact.

## Part 2 — Image generation direction consistency

**File: `src/lib/openrouter-image.server.ts`**

- `buildOutfitImagePrompt` and `generateOutfitImage` gain an optional `fallbackGenderDirection?: "Male" | "Female" | null` parameter.
- `genderLine`: unchanged when `gender` is Male/Female. Otherwise, use `presenting as ${fallbackGenderDirection.toLowerCase()}` when set; neutral (no line) when not — same wording style as the existing explicit-gender line, just reusing the DB's own "Male"/"Female" vocabulary instead of inventing "Masculine"/"Feminine".

**File: `src/server/services/look.ts`** (`renderLookImageForUser`)

- Pass `fallbackGenderDirection: data.fallback_gender_direction ?? null` through to `generateOutfitImage`'s deps object.

## Part 3 — Restart Style Analysis

**File: `src/components/style-profile/style-profile-page.tsx`**

- Add a "Restart Style Analysis" button in the page header, next to `SyncBadge`.
- Extract a small new component `src/components/style-profile/restart-style-analysis-action.tsx` (button + confirm dialog + navigate), reused from `style-profile-page.tsx` — keeps the page file from growing further and makes the action independently readable.
- Confirm dialog reuses the app's existing `ConfirmDialog` component (`src/components/ui/confirm-dialog.tsx`): title "Restart your style analysis?", description "This walks you back through your full style profile, including gender and body type. Your current profile stays until you save changes.", confirmLabel "Restart". Confirm navigates to `/onboarding/style-profile` (no `step` param, so it resolves via `getFirstIncompleteOnboardingStep` — since the profile is complete, this lands on `review`, from which every field is individually editable via `ReviewStep.onEdit`). Cancel closes the dialog, no navigation.
- Remove dead state and now-unreachable components from `style-profile-page.tsx`: `quizOpen`, `bodyQuizOpen`, the `ColorQuiz` and `BodyTypeQuiz` imports and their conditional render blocks. The color-camera re-scan entry point ("Open the camera" → `VisualDiagnosticViewfinder`) and inline pill editing remain unchanged — this only removes the two dead quiz modals that had no way to open.

## Out of scope (flagged, not solved here)

- Non-binary/Prefer-not-to-say outfit *text* (hair/makeup rationale) already says "favor gender-neutral/androgynous silhouettes" in `profileLines` — this may read slightly inconsistent with a `fallback_gender_direction`-influenced shopping pick. Not the reported bug; not addressed in this pass.
- Backfilling the product catalog with more Unisex-tagged items (would reduce reliance on the fallback path) is a content/ops task, not a code change.

## Testing

- This repo's unit tests (`bun:test`) are pure-function tests only — no `@testing-library/react` dependency exists anywhere in the codebase, and authenticated-flow e2e (Playwright) coverage doesn't currently extend to onboarding/style-profile. Follow that convention rather than introducing new test infra for this change:
  - `isGenderMatch`'s new `fallbackDirection` param, and `loadLookInventory`'s per-category fallback behavior, in `look-products.functions.test.ts`.
  - `DailyLookSchema` accepting/defaulting `fallback_gender_direction` in `generate-outfit.functions.test.ts`.
  - `buildOutfitImagePrompt`'s `fallbackGenderDirection` → `genderLine` behavior in `openrouter-image.server.test.ts`.
  - Part 3's button/dialog/navigation is verified manually (run dev server, click through) rather than automated — matches the repo's existing lack of component-render tests for this page and its onboarding siblings.
