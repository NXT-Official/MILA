# Landing Page Visual Redesign — Design

**Date:** 2026-09-28
**Status:** Approved for planning
**Scope:** Sub-project 2 of the original landing/nav QA pass. Builds on the nav-routing + compliance fixes already shipped (`docs/superpowers/specs/2026-09-28-nav-routing-landing-design.md`).

## Problem

A visual audit (full-page screenshots at 375px and 1440px of `/` and all five dedicated routes) found the landing page technically compliant with `docs/DESIGN.md` but visually flat and repetitive:

- **Only one real photograph exists on the entire page** (`public/hero-style-sheet.png`, in the hero). Every other section — Style Dossier, Daily Palette, Concierge, Dupe Hunter, Feed — communicates a visual product (outfits, colors, garments, photos) using only text and small bordered UI-mockup cards.
- **Every section repeats the same rhythm**: kicker-less heading + body copy on one side, one small card/mockup on the other (or centered), inside the same `atelier-container` max-width, with the same `py-20 sm:py-24` vertical rhythm and a `border-t` divider. Ten consecutive sections built from one template read as a spec sheet, not an editorial fashion page.
- **Motion is a single, uniform primitive**: `Reveal` fades every section in as one block (16px rise + opacity) with no variation — no staggering, no per-element sequencing, no imagery-specific treatment.

None of this is a `docs/DESIGN.md` violation — the system's tokens (color, type, radii, shadow) are used correctly throughout. This is a content and rhythm problem: the page under-uses imagery and motion for a product whose entire pitch is generated visual style.

## Goals

- Real generated imagery in every section where the copy describes a visual thing (garments, palettes, outfits, feed posts) that currently has none.
- Break the repeated one-template rhythm with layout variation (at least two sections going full-bleed instead of container-width).
- Richer, section-appropriate motion (staggered reveals, image-specific treatment, hover micro-interactions) — still fully `prefers-reduced-motion`-safe per the existing `Reveal` pattern.
- Zero changes to `docs/DESIGN.md`'s actual tokens (color, type scale, radii, shadow vocabulary) — this redesign works inside the existing, already-compliant system.

## Non-goals

- Changing the brand direction, palette, or typography (explicitly ruled out during scoping — the current system is deliberate, not generic).
- Touching the five dedicated marketing subpages' own layout beyond whatever they inherit automatically from the shared section components (they reuse the same `HowItWorksSection`/`DossierSection`/etc. components the homepage uses — see the nav-routing spec's "Deviation from spec" note. Any visual upgrade to a section component applies to its dedicated page for free.)
- Touching authenticated-app screens (dashboard, style-profile, onboarding) — separate, later sub-project.
- New CMS fields or content model changes — imagery is generated and stored as static files, not wired into Sanity.

## Imagery plan

The app already has a working, paid, production image-generation pipeline: `src/lib/openrouter-image.server.ts` calls OpenRouter's Images API (`meta/muse-image`) to generate the real "Create my look" outfit photos members see in the product. This redesign reuses the **same API and the same "realistic luxury fashion editorial photograph" visual register** (not a different, generic-stock-photo aesthetic) for marketing imagery, so the marketing page looks like the actual product output, not decoration bolted on top.

Images are generated **once**, offline, as part of implementation (not at request time) and saved as static files under `public/landing/`. They are not regenerated per-visitor and do not touch the runtime request path.

| # | Section | File | Prompt subject |
|---|---------|------|-----------------|
| 1 | Style Dossier | `public/landing/dossier-example.jpg` | Editorial full-body photo of one model in a "True Summer" (cool, muted) palette outfit — illustrates the example dossier card shown next to it. |
| 2 | Daily Palette | `public/landing/palette-flatlay.jpg` | Overhead editorial flat-lay of three garments/accessories in camel (base), deep berry (statement), and gold (accent) — the exact three swatches already shown in `DailyPaletteSection`. |
| 3 | Concierge | `public/landing/concierge-garment.jpg` | Close-up editorial photo of a black wool coat and gold hoop earrings laid together — the exact items referenced in the section's sample chat exchange. |
| 4 | Dupe Hunter | `public/landing/dupe-inspiration.jpg` | Editorial photo of a wool-blend camel maxi coat (the "inspiration" item). |
| 5 | Dupe Hunter | `public/landing/dupe-match.jpg` | Editorial photo of a visually matching camel maxi coat (the "Mila match" item) — same silhouette/color as #4, styled as a distinct, cheaper alternative. |
| 6-9 | Feed | `public/landing/feed-1.jpg` … `feed-4.jpg` | Four distinct single-outfit editorial photos, square crop, varied silhouettes/palettes — populate a 4-tile feed preview grid. |
| 10 | Final CTA | `public/landing/final-cta-bg.jpg` | Wide editorial photo (landscape crop), one model in a complete styled look, negative space on one side for text/CTA overlay legibility. |

10 images total. Each is a one-time script call against the existing OpenRouter Images API during implementation, saved to disk, committed to the repo like any other static asset (same as `hero-style-sheet.png` today). No new runtime dependency, no new API surface, no change to the product's actual image-generation code path.

## Section-by-section design

### Hero
No content change. Swap the `Reveal`'s flat fade for a subtle scale-in on the photo specifically (`scale: 0.97 → 1` alongside the existing fade), so the hero's real photo gets a slightly more deliberate entrance than the sections around it. Reduced-motion: no scale, fade only (already the pattern).

### How It Works
No imagery (this section is process/steps, not a visual product). Change the reveal from one-shot-for-the-whole-row to a staggered reveal — each of the three `<li>` steps animates in with a ~100ms offset from the previous one, using Framer Motion's `staggerChildren` on the parent. Reduced-motion: all three appear instantly together (current behavior), no stagger.

### Style Dossier
Add `dossier-example.jpg` as a new visual element beside the existing dossier-card mockup (the mockup stays — it's the actual UI artifact; the photo adds the "this is a real styled look" context the section currently lacks entirely).

### Daily Palette
Add `palette-flatlay.jpg` above or beside the three color swatches (swatches stay — they're the precise data; the photo shows what the data produces).

### Concierge
Add `concierge-garment.jpg` beside the chat bubble exchange.

### Dupe Hunter
Add `dupe-inspiration.jpg` and `dupe-match.jpg` inside the existing two-column comparison card, above each column's text (label, title, price stay exactly as they are — this is the section with the least imagery today relative to how visual its actual pitch is).

### Feed
This section currently has no visual feed representation at all — just a centered badge. Add a 2x2 grid of `feed-1.jpg`…`feed-4.jpg` as a feed preview, replacing or supplementing the current centered badge. This section also goes **full-bleed** (breaks out of `atelier-container`) as one of the two layout-rhythm-breaking moments.

### Community / Testimonials
No new imagery (lower priority, already has real content — season chips + real quote cards). No layout change beyond what it inherits from the shared `Section`/`SectionHeading` primitives.

### Pricing
No imagery. Motion only: stagger the plan cards in on reveal (same `staggerChildren` pattern as How It Works), and confirm/add the doc's own "Raised" hover shadow (`shadow-atelier-soft`/hover lift already partially present via `is_featured` styling — extend the same hover-lift treatment to all cards, not just the featured one).

### Final CTA
Add `final-cta-bg.jpg` as a full-bleed background image behind the existing heading/body/CTA button (this is the second full-bleed moment, bookending Feed). Text sits on the negative-space side of the photo with a scrim (translucent `bg-canvas/80`-style overlay, reusing the existing header's translucency pattern) to guarantee contrast — never lower text contrast to make room for a photo. Very subtle background drift on scroll (a few percent `scale`/`translateY`, reduced-motion: static).

## Motion system changes

`Reveal` (`src/components/landing/reveal.tsx`) currently only exposes a single whole-block fade+rise. Add one new variant, not a rewrite:

- A `stagger` mode (new optional prop) that, instead of animating the whole section as one block, applies `staggerChildren` to its motion variants so a list of children (steps, pricing cards, feed grid tiles) each animate in with a short delay after the previous one. Reduced-motion: `staggerChildren: 0` (all children appear together, matching current behavior) — same fallback pattern already used for the base fade.
- Hover micro-interaction: image cards (Dossier, Dupe Hunter, Feed tiles) get the doc's existing "Raised" shadow token on hover (`shadow-paper` at rest → `shadow-raised`-equivalent classes on hover, consistent with how the primary button already lifts 1px on hover) — no new token invented, reusing `docs/DESIGN.md`'s own shadow vocabulary.

## Error handling

Static image files, committed to the repo — no runtime fetch, no loading state, no error state needed. Standard `<img>`/`next/image`-equivalent handling already used elsewhere in this codebase (explicit `width`/`height`, `loading="lazy"` for below-the-fold sections per this project's own performance rules, `loading="eager"` + `fetchpriority="high"` reserved for the hero image only, which already has it).

## Testing

- Extend the existing Playwright accessibility suite (already covers `/` and the five dedicated routes) — no new routes, existing 7-route a11y scan should stay green with new images added (verify `alt` text on every new `<img>`, since axe flags missing alt text).
- Visual regression: manual screenshot comparison (375/1024/1440) before and after, same method used for this audit — no new automated visual-regression tooling introduced (YAGNI; this repo has no existing visual-regression harness and one section-by-section eyeball pass is sufficient for a single marketing page).
- `prefers-reduced-motion` check: manually verify every new animation (hero scale-in, stagger, final-CTA drift) collapses to its static/instant fallback with reduced motion enabled in the browser.

## Rollout

Single PR, same as the nav-routing pass. Images are committed as static assets — no feature flag needed.
