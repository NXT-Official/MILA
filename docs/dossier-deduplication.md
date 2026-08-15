# Dossier — remove duplicated content

Stakeholder review, 2026-08-14. Implemented in this repo; this file is the record of what was
asked, what was verified, and what shipped.

## The problem as reported

> The dossier page states the same information up to four times. The season name appears in the hero
> card, in Styling Notes, in Style DNA, and again in the calibration picker. Colour swatches appear
> in both Style DNA and Your Palette. Styling directives appear in both Style DNA and the Directives
> section.

## The principle

Each fact has exactly one canonical location, and each section has one job:

| Section                    | Owns                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Hero card                  | Season name + user attributes (undertone, lightness, contrast, silhouette, face, hair) |
| Your Palette               | All colour: primaries, accents, neutrals, avoid, combinations                          |
| Styling Notes / Directives | Actions only: silhouette, hair, makeup, textiles                                       |
| Calibrate                  | Inputs — on its own screen, not in the dossier                                         |

## Verification first: is the Streamlined / Detailed toggle the cause?

**No.** Checked before restructuring anything.

`PerspectiveSwitcher` swapped only the _edit_ block at the bottom of the page — a pill list in
Streamlined, an accordion in Detailed. Style DNA, Your Palette and Colour Combinations rendered
unconditionally, above the toggle, in both modes. Both variants were never in the same scroll, so
there was no double-render to fix. The duplication was real layout, and the restructure below is
manual, not a mounting bug fix.

## What shipped

### Dossier — `src/components/style-profile/style-profile-page.tsx` (1204 → 594 lines)

- **Style DNA deleted.** Its three colour cards (Color Season, Best Colors, Colors to Avoid)
  duplicated the hero and Your Palette outright. Its four action cards (Silhouette Strategy, Hair
  Direction, Makeup Harmony, Textile Direction) moved under **Mila's Styling Notes**, which is now
  the single Directives section.
- **Styling Notes no longer names the season.** The old copy — `Chosen by hand · Muted Summer. Every
swatch… drawn straight from the atelier's Summer Muted library.` — named it twice one card below
  the hero. It is replaced by the provenance line `ATELIER_PROVENANCE`
  (`src/constants/style-profile/dna.ts`): _"Hand-selected from the atelier library."_ The stored
  `stylistNote` is no longer rendered on the dossier at all.
- **Calibration moved off the dossier** to a new `/calibrate` screen (below). The dossier's only
  link to it is **Change my season →** in the hero card.
- **Palette Baseline accordion removed.** Season and Undertone were the whole accordion and both
  duplicate the hero grid; the edit flow for them is now Calibrate. Remaining accordion sections
  renumbered `01 / Frame`, `02 / Beauty & Texture`. The Streamlined view lost its duplicate
  `Color Season` pill row for the same reason (`Core · 01` is now Body Silhouette).
- The debounced auto-save no longer writes `color_season` / `skin_undertone`. The dossier does not
  own them any more, and writing back a stale copy would fight the Calibrate screen.
- Dead code removed: the `ColorQuiz` / `BodyTypeQuiz` modals were mounted but had no code path that
  opened them.

Resulting order: **hero → palette → combinations → styling notes/directives → edit → archive.**
Season stated once. Colour names appear once as swatches and once as combinations — intentional,
different purpose.

### New Calibrate screen — `src/components/style-profile/calibrate-page.tsx`, route `/calibrate`

Everything that _decides_ a season, in one place:

- Path 01 — the known sub-season tile picker (16 tiles) + Save.
- Path 02 — the camera diagnostic, with the by-hand season/contrast override and the silhouette
  matrix behind it.

Saving navigates back to `/profile`. The old bottom-sheet "Fine-tune your palette" picker is gone —
it was a third copy of the same 16 tiles.

### Other fixes from the same review

| Report                                                               | Fix                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "colour render on the dossier is wrong. Swatches should render 100%" | `PaletteBand` applied `opacity-80` to the _Colours to avoid_ grid, so those swatches rendered as the wrong colour. Removed. The `muted` prop is gone.                                                                                                |
| "generate random palette (circles not even)"                         | `DailyPaletteGenerator` cells used `justify-center`; grid cells stretch to the tallest colour name, so a one-line name centred its circle at a different height than a two-line one. Now `justify-start`.                                            |
| "navi bar should be icons only"                                      | Labels removed from `MobileTabBar` and `DesktopNav`; the name moves to `aria-label` + `title`. Both bars now show the same six icons.                                                                                                                |
| "when the page refreshes the entire chat log disappears"             | The messages were always persisted — only the _selection_ was React state, so a refresh landed on an empty new chat. The open conversation now lives in the URL (`/concierge?c=<id>`), which also fixes the back button and makes a thread linkable. |
| "language still sounds too AI"                                       | Copy pass on every dossier string that survived the restructure, plus the concierge system prompt: lead with the answer, 2-4 sentences, no preamble or closing offer, and a banned-words line (_elevate, effortless, curated, perfect for_).         |

## Not done, and why

- **"Can Mila generate sample looks? Even sketches?"** Not built. The machinery exists —
  `generateDailyLook` in `src/lib/generate-outfit.functions.ts` already returns a look _with an
  AI-generated image_, and `OutfitVisual` renders it on the dashboard. Wiring it into the concierge
  is a real feature, not a copy tweak: it needs a decision on when a reply becomes a generated look
  (every outfit answer? a button on the reply?) and it costs a credit per image. Recommendation:
  a "Show me this look" button on any reply that describes an outfit, calling the existing function
  with the profile the concierge already loads. Wants its own pass.
- **"apply CC's suggestions on improving the overall language"** — those suggestions were not in
  this session. What shipped is a pass over the strings on the pages under review; a full-app copy
  audit needs the original list.
- `src/components/style-profile/color-quiz.tsx` (572 lines) and `body-type-quiz.tsx` (201 lines) are
  now unreferenced. Left in place rather than deleted unasked — they are candidates for the next
  cleanup.

## Checks

`npx tsc --noEmit`, `npx eslint src --max-warnings=0`, `bun test` (108 pass), `npx vite build` — all
green.
