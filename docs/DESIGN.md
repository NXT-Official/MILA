---
name: Mila
description: AI-assisted personal styling — a couturier's client dossier rendered as software.
colors:
  canvas: "#f5f0e8"
  surface: "#faf8f5"
  ink: "#2b2320"
  body: "#6b6259"
  champagne: "#c9a96e"
  champagne-soft: "#f5ecd9"
  line: "#e8d5b0"
  rose: "#d2a4a0"
  success: "#35794b"
  warning: "#c56c21"
  destructive: "#cc2827"
  dark-canvas: "#110c09"
  dark-surface: "#1b1612"
  dark-ink: "#ebe7e2"
  dark-body: "#b1a9a1"
  dark-champagne: "#c6ad8b"
typography:
  display:
    fontFamily: "Playfair Display, Times New Roman, Georgia, serif"
    fontSize: "clamp(2.25rem, 6vw, 3rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Playfair Display, Times New Roman, Georgia, serif"
    fontSize: "3.25rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Playfair Display, Times New Roman, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "0"
    fontFeature: "ss01, cv11"
  label:
    fontFamily: "Inter, Helvetica, Arial, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.25em"
rounded:
  control: "0.75rem"
  panel: "1rem"
  card: "1.25rem"
  overlay: "1.5rem"
  pill: "9999px"
spacing:
  card-padding: "1.5rem"
  control-x: "1.25rem"
  page-x: "1.25rem"
  page-y: "1.5rem"
  section-y: "3.5rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0 1.25rem"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "#2b2320e6"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 1.25rem"
    height: "2.75rem"
  button-secondary-hover:
    backgroundColor: "{colors.champagne-soft}"
    textColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 1.25rem"
    height: "2.75rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "1.5rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.25rem 0.875rem"
    height: "2.75rem"
  badge:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.625rem"
---

# Design System: Mila

## 1. Overview

**Creative North Star: "The Atelier Dossier"**

Mila looks like a couturier's private client file. Ivory paper stock, pencil-fine
rules, a serif that knows what it's doing, and gold used exactly once per page.
The dossier metaphor is not decoration — it is the product: Mila's whole premise
is that a member has a durable style file, and the interface is that file made
navigable. Every utility class in the codebase already carries the name
(`atelier-card`, `atelier-page`, `atelier-glass`); this document makes the
metaphor normative rather than incidental.

Restraint here reads as expertise. The system is warm but never soft, and quiet
but never cold: warmth comes from the cream canvas, the serif, and the paper
grain (a 4%-opacity fractal-noise overlay on `body`), not from bright colour or
rounded-everything geometry. Density is moderate — this is a phone-first daily
tool, so surfaces breathe, but nothing is so sparse that a member has to hunt.

The system explicitly rejects the four anti-references named in PRODUCT.md:
generic SaaS dashboard, fast-fashion e-commerce, beauty-app cliché, and cold
luxury minimalism. Concretely that means: no hero stat tiles, no discount badges
or urgency banners, no millennial-pink gradients or emoji, and no all-caps
monochrome sparseness that costs legibility.

**Key Characteristics:**

- Cream canvas (`#f5f0e8`) with a fixed paper-grain overlay; surfaces sit one
  step lighter (`#faf8f5`)
- Playfair Display for every heading, Inter for everything else — a serif/sans
  contrast pairing, never two similar sans faces
- Champagne gold as a single accent, held to well under 10% of any screen
- Five-step radius hierarchy mapped to control *size*, base radius a tight
  `0.25rem`
- Shadows reserved for things that genuinely float; the in-app grid is
  line-separated
- Full parity light/dark via `:root` / `.dark`, both hand-tuned in OKLCH

## 2. Colors

A warm neutral ground with one metallic accent — the palette is deliberately
quiet so that garment colour, palette swatches, and season chips are the most
saturated things on screen.

Canonical values are authored in OKLCH in `app/src/styles.css`; the frontmatter
carries sRGB hex for tooling compatibility, and `.impeccable/design.json` carries
the OKLCH originals.

### Primary

- **Ink** (`#2b2320`): The near-black warm brown that carries all headings, body
  emphasis, primary button fills, and dark controls. It is a *brown*-black, not a
  neutral one — pure `#000` is prohibited anywhere in this system. 13.57:1 on
  canvas.

### Secondary

- **Champagne Gold** (`#c9a96e`): The single accent. Its jobs are active states,
  focus rings, hover washes (via Champagne Veil), and one deliberate emphasis per
  screen. It is **not** a text colour on light surfaces — at 1.97:1 on canvas it
  fails AA badly.
- **Champagne Veil** (`#f5ecd9`): The soft form of the accent, used as hover and
  selected-state background wash on secondary/outline/ghost buttons and row
  actions. Never as a text colour.

### Tertiary

- **Powder Rose** (`#d2a4a0`): A reserved, near-desaturated rose. Present in the
  token set for beauty/makeup contexts and seasonal warmth. Use sparingly and
  never as a general-purpose second accent — the system has one accent.

### Neutral

- **Paper Cream** (`#f5f0e8`): The page canvas. Carries the fixed fractal-noise
  grain at 4% opacity, disabled under `prefers-reduced-transparency` and
  `prefers-contrast: more`.
- **Porcelain** (`#faf8f5`): Cards, panels, inputs, popovers. One step lighter
  than the canvas — surfaces lift by getting *brighter*, never by getting a
  border-radius bump.
- **Pencil** (`#6b6259`): Default body text and secondary/muted text (the two are
  the same value by design). 5.26:1 on canvas, 5.63:1 on surface.
- **Rule** (`#e8d5b0`): Borders and dividers. A warm tan, never a grey — grey
  lines on cream read as dirty.

### Semantic

- **Forest** (`#35794b`) success, **Amber** (`#c56c21`) warning, **Signal**
  (`#cc2827`) destructive. Sparse, and never the only carrier of a state.

### Named Rules

**The One Gold Rule.** Champagne Gold appears on at most ~10% of any screen's
pixels, and carries at most one *emphatic* job per view. Its rarity is the entire
point. If a screen has a gold button and a gold badge and a gold border, two of
them are wrong.

**The Gold-Is-Not-Ink Rule.** Champagne Gold is forbidden as a text colour on
Paper Cream or Porcelain. It fails AA at 1.97:1. Gold may fill a surface behind
Ink text, outline a focus ring, or wash a hover state — it may never *be* the
text.

**The Warm-Neutral Rule.** Every neutral in this system is tinted toward the
brand's warm hue. Pure greys and pure black are prohibited. If a value's chroma
is zero, it is wrong.

**The Colour-Is-Content Rule.** Season palettes, garment colours, and swatches
are *data*. Chrome colour must never compete with them, and product state must
never be encoded in hue alone — every coloured status carries a label, icon, or
shape alongside it.

## 3. Typography

**Display Font:** Playfair Display (with Times New Roman, Georgia, serif)
**Body Font:** Inter (with Helvetica, Arial, sans-serif)

**Character:** A high-contrast transitional serif against a neutral grotesque —
contrast on the serif/sans axis, exactly as it should be. Playfair supplies the
editorial authority (this is a styling house, not a startup); Inter disappears
and does its job. Body copy runs with `font-feature-settings: "ss01", "cv11"` for
a disambiguated `l` and single-storey alternates.

### Hierarchy

- **Display** (800, `clamp(2.25rem, 6vw, 3rem)`, line-height 1, tracking
  `-0.02em`): The `.atelier-title` class. Section and page openers on marketing
  and hero surfaces. Well under the 6rem ceiling — Mila does not shout.
- **Headline** (700, `3.25rem`, line-height 1, tracking `-0.02em`): Bare `h1`.
  One per page.
- **Title** (600, `2rem`, line-height 1.25, tracking `-0.015em`): Bare `h2`.
- **Subtitle** (`.atelier-headline`: serif, `1.5rem`, snug leading, tight
  tracking): Card and panel headings inside the app.
- **Body** (400, `1rem`, line-height 1.625): Default. Cap measure at 65–75ch;
  `--container-reading` (46rem) exists for exactly this.
- **Label** (600, `0.625rem`, tracking `0.25em`, uppercase): The `atelier-label`
  utility. Metadata and table column headers only.

### Named Rules

**The Serif-Is-Structure Rule.** Playfair is reserved for headings and the
occasional pulled quote. It never sets body copy, never sets UI labels, never
sets button text. Inter never sets an `h1`.

**The Tracking Floor Rule.** Display letter-spacing never goes below `-0.04em`.
The system's own floor is `-0.02em`; do not tighten past it for effect.

**The No-Eyebrow Rule.** The tiny uppercase tracked kicker above every section is
prohibited. `.atelier-kicker` (`styles.css:263`) is a legacy of that pattern and
additionally fails contrast; treat it as deprecated. One named kicker used
deliberately as a brand device is voice; a kicker on every section is scaffolding.

**The Balance Rule.** `text-wrap: balance` on `h1`–`h3`; `text-wrap: pretty` on
long prose.

## 4. Elevation

Hybrid, with a hard boundary: **in-app surfaces are separated by 1px Rule lines
and are flat at rest; only elements that genuinely float above the page cast a
shadow.** Depth in the body of the app is communicated tonally — Porcelain on
Paper Cream — not with shadow. The shadow scale exists for overlays, navigation,
and drag/lift states, and it is diffuse and warm-tinted (built from the Ink hue
at low alpha), never a hard grey drop.

### Shadow Vocabulary

- **Paper** (`0 1px 2px oklch(0.264 0.013 41.6 / 0.04), 0 10px 30px oklch(0.264 0.013 41.6 / 0.07)`):
  The resting sheet. Cards on marketing surfaces and any card that must read as a
  physical object. Inside the app grid, prefer a Rule border instead.
- **Raised** (`0 4px 10px oklch(0.264 0.013 41.6 / 0.06), 0 20px 50px oklch(0.264 0.013 41.6 / 0.1)`):
  Hover lift, popovers, dropdowns, floating panels.
- **Nav** (`0 12px 40px oklch(0.1 0.01 55 / 0.2)`): Sticky navigation, sheets,
  dialogs, toasts. The only shadow permitted to be visibly dark.

Dark mode uses the same three roles with black-based alphas raised to 0.3–0.5,
because tonal separation alone is too weak on a `#110c09` canvas.

### Named Rules

**The Float-Only Rule.** If it does not overlap other content, it does not cast a
shadow. Dashboard cards, list rows, and form panels get a Rule border. Dialogs,
sheets, dropdowns, popovers, toasts, and sticky nav get shadow.

**The No-Nesting Rule.** A shadowed surface never contains another shadowed
surface. Nested cards are always wrong.

**The 2014 Test.** If a shadow reads as a hard edge rather than ambient
falloff, the alpha is too high and the blur radius is too small.

## 5. Components

All primitives live in `app/src/components/ui/`. Radix backs everything requiring
focus management, portals, or keyboard navigation — none of it is reimplemented
with plain `<div>`s. Variants use `class-variance-authority`; `cn()`
(`clsx` + `tailwind-merge`) is the only class-merging utility.

The overall character is **refined and restrained**: small radii, thin warm
lines, and state changes you feel more than see. The 1px hover lift on the
primary button is the loudest gesture the system permits.

### Buttons

- **Shape:** Gently curved (`rounded-control`, `0.75rem`). `pill` and `chip`
  sizes go fully round (`rounded-pill`).
- **Sizes:** `sm` 36px, `md` 44px (default), `lg` 48px, `icon` 44px square,
  plus `pill` (40px, uppercase, `0.2em` tracking) and `chip` (36px).
  **44px is the phone-first floor for anything in a primary daily flow.**
- **Primary:** Ink fill, Porcelain text (14.52:1). Horizontal padding `1.25rem`.
- **Hover / Focus:** Primary lifts by exactly 1px (`-translate-y-px`) and darkens
  to 90% Ink; returns to 0 on `:active`. Transition is 200ms on the
  `ease-editorial` curve (`cubic-bezier(0.22, 1, 0.36, 1)`) and is scoped to
  colour, border, shadow, and transform — never to layout properties.
- **Secondary:** Porcelain fill, Rule border, Ink text; hover washes to Champagne
  Veil at 60%.
- **Outline:** Canvas fill, Rule border; hover washes to Champagne Veil at 40%.
- **Ghost:** Transparent; hover washes to Champagne Veil at 50%.
- **Destructive:** Signal fill, near-white text. Confirmation actions only.
- **Glass:** `atelier-glass` (backdrop blur over translucent canvas). **Reserved
  for image-overlay contexts only** — buttons over outfit photography where no
  solid fill would be legible. It is not a decorative default.
- **Loading:** `loading` swaps in a spinning `Loader2`, disables the control, and
  sets `aria-busy`. Never remove the label.

### Cards / Containers

- **Corner Style:** `rounded-card` (`1.25rem`); panels use `rounded-panel`
  (`1rem`); dialogs and sheets use `rounded-overlay` (`1.5rem`).
- **Background:** Porcelain on Paper Cream.
- **Border:** 1px Rule. This is the primary separation mechanism in-app.
- **Shadow Strategy:** `shadow-paper` per `.atelier-card`, but see The Float-Only
  Rule — inside dense app views the border alone should carry it.
- **Internal Padding:** `1.5rem` (`p-6`) on header, content, and footer slots.
- **Hero variant:** `.atelier-hero-card` uses a three-stop diagonal cream
  gradient (`#f0e6d3 → #faf8f5 → #f5f0e8`), with a hand-tuned dark counterpart.
  One per page maximum.

### Inputs / Fields

- **Style:** 44px tall, Porcelain fill, 1px Rule border, `rounded-control`,
  `0.875rem` horizontal padding, Ink text.
- **Icon slots:** Optional leading and trailing Lucide icons at `size-4`,
  `strokeWidth` 1.75, Pencil colour, `aria-hidden`, with padding shifted to
  `pl-10` / `pr-10`. Icons are decorative; the label carries the meaning.
- **Focus:** `atelier-focus-ring` — a 2px Champagne ring with a 2px offset
  against the canvas. Global fallback is a 2px Champagne outline at 2px offset.
- **Placeholder:** Pencil (`#6b6259`), which holds 5.63:1 on Porcelain. Do not
  lighten it.
- **Disabled:** 50% opacity, `not-allowed` cursor.

### Badges / Chips

- **Style:** `rounded-pill`, 1px Rule border, transparent fill, Ink text at
  `0.75rem`/600.
- **Rule:** A badge's colour is never its only signal. Season tags, moderation
  states, and credit warnings carry text or an icon in addition to colour.

### Navigation

- Sidebar icons at `size-[18px]`, `strokeWidth` 1.75, inheriting `currentColor`.
- Active state is Ink text plus a Champagne Veil wash — **not** a coloured
  side-stripe.
- Sticky nav is the one chrome element permitted `shadow-nav`.
- Mobile: bottom-anchored, 44px minimum targets, thumb-reachable.

### Signature Component: The Season Tag

`app/src/components/landing/season-tag.tsx`. The one place a saturated,
non-brand colour is not only allowed but required: it renders a member's
16-season colour identity. Its swatch colour is *data*. It must always pair the
swatch with the season's name — the Colour-Is-Content Rule applies most strictly
here, since a portion of the audience cannot distinguish the swatches at all.

## 6. Do's and Don'ts

### Do:

- **Do** use the five-step radius hierarchy by control *size*
  (`control 0.75rem` → `panel 1rem` → `card 1.25rem` → `overlay 1.5rem` →
  `pill`), never by taste.
- **Do** separate in-app surfaces with a 1px Rule (`#e8d5b0`) border and reserve
  shadow for things that overlap content.
- **Do** keep Champagne Gold under ~10% of any screen and behind Ink, never as
  text on a light ground.
- **Do** hold body copy to 65–75ch; `max-w-reading` (46rem) exists for this.
- **Do** give every animation a `prefers-reduced-motion` alternative — a
  crossfade or an instant change, not the removal of the affordance.
- **Do** pair every colour-coded state with a label, icon, or shape. This product
  is about colour; a member with a colour-vision difference must still be able to
  use it.
- **Do** use `ease-editorial` (`cubic-bezier(0.22, 1, 0.36, 1)`) at ~200ms for
  state changes, and animate only transform, opacity, colour, and shadow.
- **Do** keep interactive targets at 44px in the daily morning flow.
- **Do** import Lucide icons by name, `aria-hidden` when decorative, `aria-label`
  on icon-only controls.

### Don't:

- **Don't** build a **generic SaaS dashboard**: no hero stat tile with a big
  number and small label, no identical icon+heading+text card grids repeated down
  a page, no blue-and-white, no gradient accents.
- **Don't** build **fast-fashion e-commerce**: no discount badges, urgency
  banners, countdown timers, or dense unspaced product grids. Mila recommends; it
  does not liquidate stock.
- **Don't** build **beauty-app cliché**: no millennial-pink gradients, no bubbly
  oversized radii, no emoji, no quiz-app gamification or streaks.
- **Don't** build **cold luxury minimalism**: restraint may never cost
  legibility. All-caps monochrome sparseness is not the goal.
- **Don't** use `background-clip: text` with a gradient. Gradient text is banned.
- **Don't** use `border-left` / `border-right` greater than 1px as a coloured
  accent stripe on cards, rows, callouts, or alerts. Use a full Rule border, a
  Champagne Veil wash, or nothing.
- **Don't** nest a shadowed surface inside another shadowed surface.
- **Don't** put a tiny uppercase tracked eyebrow above every section.
  `.atelier-kicker` is deprecated: it fails AA at 1.97:1 *and* it is the
  saturated AI scaffold.
- **Don't** use `atelier-glass` decoratively. It exists for controls over
  photography.
- **Don't** introduce pure grey or pure black. Every neutral is warm-tinted.
- **Don't** introduce a second accent colour. Powder Rose is contextual, not a
  co-primary.
- **Don't** ship an `h1` in Inter or body copy in Playfair.
- **Don't** gate content visibility on a scroll-triggered class. Reveals enhance
  an already-visible default, or the section ships blank in headless renderers.
- **Don't** let a heading overflow its container. Test the real copy at every
  breakpoint; the viewport is part of the design.
