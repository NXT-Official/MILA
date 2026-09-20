# Landing page visual redesign — design

Status: **approved, not started.** Written 2026-09-21, follow-up to the UI/UX consistency
refactor completed earlier the same day (see `MILA_CHANGELOG_2026-09-18_to_09-20.md` and
`/Users/hoon/.claude/plans/sequential-toasting-cascade.md` for that prior pass).

## Context

The earlier refactor fixed the landing page's *mechanical* problems (missing mobile nav, missing
`md:` breakpoint causing stuck-2-column grids, text-overflow safeguards) but explicitly left its
*visual* design untouched: 4 hand-rolled duplicate "card" recipes, 3 inconsistent heading clamp
scales, `hero-section.tsx` and `final-cta-section.tsx` bypassing the shared `Section` component,
one-off `Button`/`IconTile` overrides. The user asked for a full redesign of those, not just the
bug fixes.

**Hard constraint carried over from the prior pass:** the color palette (CSS var values in
`src/styles.css` `:root`/`.dark`) does not change. Only layout, typography scale, and container
treatment are in scope.

## Decisions locked during brainstorming

- **Style direction: editorial / magazine.** Big serif type, asymmetric grids, pull quotes,
  generous whitespace, image-led where possible. Builds on the existing warm-ivory/serif
  "atelier" identity rather than fighting it (ruled out Swiss/International for that reason;
  ruled out dark-luxury outright since the palette is frozen to the current light tokens).
- **Section inventory: unchanged.** Hero, How It Works, Dossier, Dupe Hunter,
  Community+Testimonials, Final CTA, Header, Footer. Same CMS shape
  (`src/lib/landing-content.ts` / `landing-content.functions.ts`) — no Sanity schema changes.
  Redesign is a full visual rebuild of each section, not a re-ordering or content restructure.
- **Typography: keep Playfair Display (serif) + Inter (sans).** No font-family change. The
  redesign fixes the *scale* inconsistency, not the typeface choice.
- **Imagery: no real photography.** The landing CMS schema
  (`src/lib/landing-content.functions.ts`'s `LANDING_QUERY`) has zero image fields, and the
  Sanity Studio/schema itself isn't in this repo — image fields can't be added from here. The
  hero "preview" and other visual moments stay data-driven UI mockups (as today), executed to a
  higher, more deliberate editorial standard rather than swapped for photos.
- **Container treatment: editorial rules over boxy cards, with one exception.** Ditch the
  hand-rolled bordered-card recipe wherever a rule/divider/whitespace layout reads better
  (How It Works, Testimonials). Keep a real contained card — reusing the app's canonical
  `rounded-card` + `border-border` + `bg-card` + `shadow-paper` recipe — only where content
  genuinely needs a bounded surface: the Dossier data table and the Dupe Hunter comparison.
- **Motion: keep it subtle.** Same `Reveal`-style fade+16px-slide entrance per section
  (`src/components/landing/reveal.tsx`), already respects `prefers-reduced-motion`. No
  scroll-jacking, parallax, or scroll-linked type animation — ruled out as more visual craft than
  the ask warrants, and more surface area for motion accessibility regressions.

## Foundation changes (`src/components/landing/section.tsx`, `src/styles.css`)

1. **Two deliberate heading tiers, replacing three arbitrary ones.**
   - Hero display scale: own tier, stays the largest text on the page (correct marketing
     hierarchy — not merged with the section-heading tier). Defined once, not as an inline
     `text-[clamp(...)]` string copy-pasted at the call site. Gets `text-balance` (Hero's h1
     currently lacks it, inconsistent with its own body copy which has `text-pretty`).
   - Section heading scale: **one** clamp value shared by `SectionHeading` (already used by
     How It Works / Dossier / Dupe Hunter / Community) **and** Final CTA, which currently
     hand-rolls its own third scale. Final CTA switches to rendering through `SectionHeading`
     instead of duplicating it.
2. **`Section` component**: keep its current default (`border-t`, `atelier-container`,
   `py-20 sm:py-24`) as the baseline every section uses, including Hero and Final CTA (both
   currently bypass it entirely and hand-roll their own container/padding/border). Add a `bleed`
   or `tight` variant only if a specific section's asymmetric layout needs to break the standard
   padding — decide per-section during implementation, not speculatively upfront.
3. **`IconTile`**: add a `size` prop (`sm` | `md`) instead of the one-off
   `className="size-10"` override currently in `dossier-section.tsx`.
4. **`Button` pill usage**: `site-header.tsx`'s nav CTA hand-overrides classes to approximate
   the existing `size="pill"` (`h-11 rounded-full px-5`) — switches to `size="pill"` directly,
   dropping the override. `cta-button.tsx` (the primary hero/final-CTA conversion button) is
   visually bigger and more prominent than the nav CTA by design (`size="lg"` + an override to
   `h-12 rounded-full px-8 text-xs uppercase tracking-label`) — collapsing it to the same small
   `pill` size as the secondary nav button would be a real visual downgrade, not a cleanup. Its
   override is promoted to a new named `Button` size, `"pill-lg"`
   (`h-12 rounded-full px-8 text-xs uppercase tracking-label`), matching the exact look it
   already has today — same pattern as this session's earlier `Badge` tone / `Button` "row"
   additions (codify a repeated one-off into a real variant, don't force two different things to
   share one size).

No new CSS var **values**. Any new utility classes added to `styles.css` are additive only.

## Section-by-section redesign

### Hero (`hero-section.tsx`)
Goes asymmetric two-column from the start, rather than stacked-and-centered: text (kicker,
display headline, subhead, CTA, `ctaNote`) on the left; the outfit `preview` data on the right.
The preview panel drops its current card border/shadow/hand-rolled `rounded-card` treatment and
becomes an editorial spec-sheet: season/weather/outfit/hair/makeup rendered as a styled
definition list with a single rule above/below rather than a boxed card, in the spirit of a
couture order form. Same `HeroContent.preview` fields, no data shape change. Decorative background
blur kept but toned down/repositioned so it reads as a color wash rather than a generic SaaS glow.
Collapses to a single stacked column (preview below text) below `lg`, same as today.

### How It Works (`how-it-works-section.tsx`)
The 3 hover-lift bordered cards are replaced by an editorial numbered list: an oversized serif
numeral (01 / 02 / 03) beside each step, `IconTile` shrinks to a secondary role next to the
numeral rather than being the card's focal point, steps separated by a thin horizontal rule
instead of individual borders. Desktop: 3-column rule-divided row. Tablet/mobile: stacks with
rule dividers between steps (the `md:grid-cols-3` breakpoint fix from the prior pass still
applies to whatever grid/flex structure replaces the current one).

### Dossier (`dossier-section.tsx`)
Text column (via `SectionHeading`) stays on the left. The right-side data panel **stays a real
card** — this is the one section where a bounded surface is genuinely correct (a data table),
using the app's canonical `rounded-card` / `border-border` / `bg-card` / `shadow-paper` recipe
instead of its current one-off `border border-border bg-surface`. Row rhythm tightened, the
completion bar becomes a thinner accent-colored progress line instead of the current thick bar
(still driven by the same `completionPercent` inline `style width`, per the existing comment
explaining why that's unavoidable for a runtime value).

### Dupe Hunter (`dupe-hunter-section.tsx`)
Currently two stacked `DupeRow`s inside one card. Redesign keeps the single contained card
(comparison content also genuinely wants a bounded surface) but restructures it as a diptych: a
vertical rule splits "inspiration" and "Mila match" side by side instead of stacking. Price
treatment gets a strikethrough (inspiration, already present) → solid emphasis (match, already
present) visual pairing made more deliberate at the new layout's scale. `min-w-0` overflow
safeguard from the prior pass carries over unchanged.

### Community + Testimonials (`community-section.tsx`, `testimonials-section.tsx`)
Community's season-tag chip row is unchanged (already identified as clean in the prior audit).
Testimonials lose their 3rd duplicate hand-rolled card: become an editorial "quote wall" —
oversized quote-mark glyph, testimonials separated by rules rather than boxed/shadowed, season
tag rendered as a small caption beneath each quote rather than inline in a card footer. Already
wrapped in its own `Reveal` (added in the prior pass) — unaffected by this visual change.

### Final CTA (`final-cta-section.tsx`)
Switches from hand-rolled `border-t` + `atelier-container py-28 sm:py-36 lg:py-44` + one-off
heading scale to rendering through `Section` + `SectionHeading` like every other section (see
Foundation §2 and §1). CTA button uses `size="pill"` directly (Foundation §4).

### Header / Footer (`site-header.tsx`, `site-footer.tsx`)
No structural change — mobile nav sheet was already added in the prior pass. Only change is
dropping the ad hoc button override per Foundation §4.

## Out of scope

- Sanity schema / CMS changes (no repo access to the schema).
- Real photography or screenshot assets (none available; see Imagery decision above).
- Section re-ordering, merging, or splitting.
- Font-family changes.
- Scroll-jacking / parallax / scroll-linked motion.
- Color token value changes.

## Verification

Same discipline as the prior refactor pass:
- `tsc --noEmit` and `npm run build` clean after each file.
- `git diff src/styles.css` shows only additive lines, zero changes inside `:root {}` / `.dark {}`.
- Responsive check at 320 / 375 / 768 / 1024 / 1440 / 1920 for every touched section, via the dev
  server (`nvm use 22 && npm run dev` → https://localhost:8080/ — Node 20 fails with an
  `undici`/webidl crash, must use Node 22).
- Reduced-motion: confirm `Reveal`'s existing `useReducedMotion` handling is unaffected by the
  JSX restructure in each section.
