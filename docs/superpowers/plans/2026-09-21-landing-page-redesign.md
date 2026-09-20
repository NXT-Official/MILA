# Landing Page Editorial Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the MILA marketing landing page (`src/routes/index.tsx` + `src/components/landing/*`) into an editorial/magazine visual style, resolving the 4 duplicate hand-rolled card recipes, the 3 clashing heading scales, and the two sections that bypass the shared `Section` component — without changing any color token value.

**Architecture:** Foundation-first: extend the shared primitives (`section.tsx`, `styles.css`, `button.tsx`) with the pieces every section needs (unified heading scale, `IconTile` size prop, a proper large-pill `Button` size), then redesign each of the 6 sections + header/CTA cleanup against those primitives, one file at a time, each independently verified.

**Tech Stack:** React 19, TanStack Start, Tailwind v4 (CSS-var tokens in `src/styles.css`), TypeScript, Node 22 (Node 20 crashes the dev server — `undici`/webidl error).

**Spec:** `docs/superpowers/specs/2026-09-21-landing-page-redesign-design.md`

---

## Verification commands used throughout

Every task's verification steps use these two commands (repo root: `/Users/hoon/NXT Official/MILA`):

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npx tsc --noEmit --pretty false
```
Expected: no output (clean).

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run build
```
Expected: ends with `✓ built in ...` and `[nitro] ✔ You can preview this build using npx vite preview`, no errors.

Dev server for manual responsive checks (only needed once, keep it running across tasks):
```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run dev
```
Then open https://localhost:8080/ in a browser. Check each touched section at 320, 375, 768, 1024, 1440, 1920px widths — confirm no overflow/clipping, no orphaned single-column-of-3 layouts between breakpoints, and (where the section is redesigned in that task) that it matches the task's described layout.

---

### Task 1: Foundation primitives

**Files:**
- Modify: `src/components/landing/section.tsx`
- Modify: `src/styles.css`
- Modify: `src/components/ui/button.tsx`

- [ ] **Step 1: Add the hero heading utility to `styles.css`**

In `src/styles.css`, inside the existing `@layer components { ... }` block (it currently ends with `.atelier-focus-ring`), add a new class. Insert it right after the `.atelier-focus-ring` rule (before the closing `}` of `@layer components`):

```css
  .landing-hero-heading {
    @apply text-[clamp(3rem,8vw,5rem)] leading-[0.95] text-balance;
  }
```

This centralizes the hero's headline scale (previously an inline arbitrary string in `hero-section.tsx`) into one named class, and adds `text-balance` which the current inline version is missing (its body copy already uses `text-pretty`, the heading had nothing). The clamp values themselves are unchanged — same visual size as today, just centralized and balanced.

- [ ] **Step 2: Add the `pill-lg` Button size in `src/components/ui/button.tsx`**

Find the `size` object inside `buttonVariants` (currently):

```ts
      size: {
        sm: "h-9 px-3.5 text-xs",
        md: "h-11 px-5",
        lg: "h-12 px-7 text-base",
        icon: "size-11 p-0",
        pill: "h-11 rounded-full px-5",
        chip: "h-9 gap-1.5 rounded-full px-3 text-micro uppercase tracking-label-wide",
        row: "h-12 w-full justify-between px-4 text-sm",
      },
```

Replace it with (adds one new line, `"pill-lg"`, nothing else changes):

```ts
      size: {
        sm: "h-9 px-3.5 text-xs",
        md: "h-11 px-5",
        lg: "h-12 px-7 text-base",
        icon: "size-11 p-0",
        pill: "h-11 rounded-full px-5",
        "pill-lg": "h-12 rounded-full px-8 text-xs uppercase tracking-label",
        chip: "h-9 gap-1.5 rounded-full px-3 text-micro uppercase tracking-label-wide",
        row: "h-12 w-full justify-between px-4 text-sm",
      },
```

This codifies `cta-button.tsx`'s current one-off override (`rounded-full px-8 text-xs uppercase tracking-label` on top of `size="lg"`) as a real named variant, so Task 8 can drop the override entirely instead of reinventing it.

- [ ] **Step 3: Add an `IconTile` size prop in `src/components/landing/section.tsx`**

Replace the current `IconTile` export:

```tsx
export function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-panel border border-border bg-accent-soft/50 text-ink",
        className,
      )}
    >
      <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}
```

with:

```tsx
export function IconTile({
  icon: Icon,
  size = "md",
  className,
}: {
  icon: LucideIcon;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-panel border border-border bg-accent-soft/50 text-ink",
        size === "sm" ? "size-9" : "size-11",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-4" : "size-5"} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}
```

Leave `Section`, `Eyebrow`, and `SectionHeading` in this file unchanged — `SectionHeading`'s existing `text-[clamp(2rem,4vw,3rem)]` is already the single definition every section (except Final CTA, fixed in Task 7) uses; it doesn't need to move.

- [ ] **Step 4: Verify**

Run both verification commands from the top of this plan. Both must be clean (no tsc output, build succeeds). Nothing visual has changed yet — `IconTile`'s default (`size="md"`) renders identically to before, `pill-lg` and `.landing-hero-heading` aren't consumed by any call site until later tasks.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/section.tsx src/styles.css src/components/ui/button.tsx
git commit -m "feat: add landing redesign foundation primitives (hero heading scale, pill-lg button size, IconTile size prop)"
```

---

### Task 2: Hero redesign

**Files:**
- Modify: `src/components/landing/hero-section.tsx`

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/components/landing/hero-section.tsx` with:

```tsx
import { Brush, Scissors, Shirt, Sparkles, type LucideIcon } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { SeasonTag } from "@/components/landing/season-tag";
import { CtaButton } from "@/components/landing/cta-button";
import { Eyebrow } from "@/components/landing/section";
import type { HeroContent } from "@/lib/landing-content";

function SpecRow({ label, value, icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="flex flex-col gap-1.5 py-5">
      <Eyebrow icon={icon}>{label}</Eyebrow>
      <p className="text-base leading-relaxed text-foreground">{value}</p>
    </div>
  );
}

export function HeroSection({ content }: { content: HeroContent }) {
  const { preview } = content;

  return (
    <Reveal id="top" className="relative isolate pb-20 pt-16 sm:pb-28 sm:pt-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-48 -z-10 mx-auto h-[26rem] max-w-2xl rounded-full bg-accent/15 blur-[130px]"
      />

      <div className="atelier-container">
        <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3.5 py-1.5 text-label font-semibold uppercase tracking-label text-ink">
              <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
              {content.kicker}
            </span>

            <h1 className="landing-hero-heading mt-8 text-foreground">
              {content.headlineLine1}
              <br />
              <span className="text-muted-foreground">{content.headlineLine2}</span>
            </h1>

            <p className="mt-7 max-w-lg text-lg leading-relaxed text-pretty text-muted-foreground">
              {content.subhead}
            </p>

            <div className="mt-10 flex flex-col items-start gap-3.5">
              <CtaButton className="w-full sm:w-auto" />
              <span className="text-xs text-muted-foreground">{content.ctaNote}</span>
            </div>
          </div>

          {/* The artifact: one composed look, presented as an editorial spec sheet rather than a boxed card. */}
          <div className="border-t border-border pt-8 lg:border-t-0 lg:border-l lg:pl-14 lg:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
              <SeasonTag season={preview.season} />
              <span className="text-micro uppercase tracking-label-wide text-muted-foreground">
                {preview.weather}
              </span>
            </div>

            <div className="border-b border-border py-5">
              <Eyebrow icon={Shirt}>Outfit</Eyebrow>
              <p className="mt-3 font-serif text-2xl leading-snug text-balance text-foreground">
                {preview.outfitTitle}
              </p>
              <p className="mt-3 text-base leading-relaxed text-pretty text-muted-foreground">
                {preview.outfitBody}
              </p>
            </div>

            <div className="divide-y divide-border">
              <SpecRow label="Hair" value={preview.hair} icon={Scissors} />
              <SpecRow label="Makeup" value={preview.makeup} icon={Brush} />
            </div>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
```

What changed vs. the previous version: layout goes from stacked-and-centered (text block, then a full-width bordered/shadowed card below) to a two-column grid at `lg:` (text left, preview right, vertically centered via `items-center`), single column below `lg:` (preview stacks below text with a top rule, same as today's visual order). The preview panel drops `rounded-card border border-border bg-surface shadow-raised` entirely — it's now rule-divided (`border-b`/`divide-y`), no card chrome. Uses the new `.landing-hero-heading` class instead of the inline `text-[clamp(3rem,8vw,5rem)] leading-[0.95]` string. `Facet` renamed to `SpecRow` (same behavior, name reflects the new spec-sheet framing).

- [ ] **Step 2: Verify**

Run both verification commands. Both must be clean.

- [ ] **Step 3: Manual check**

With the dev server running, open `/` and check the hero at 320, 375, 768, 1024, 1440, 1920px:
- Below 1024px (the `lg` breakpoint): single column, preview panel below the text block with a visible top rule, no card border/shadow around it.
- At 1024px+: two columns side by side, preview panel has a left rule (no top rule), content vertically centered against the text column.
- Headline wraps sensibly at all widths (that's what `text-balance` is for) — no orphaned single word on its own line at common widths.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/hero-section.tsx
git commit -m "feat: redesign landing hero as asymmetric editorial layout"
```

---

### Task 3: How It Works redesign

**Files:**
- Modify: `src/components/landing/how-it-works-section.tsx`

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/components/landing/how-it-works-section.tsx` with:

```tsx
import { UserRound, WandSparkles, Users } from "lucide-react";
import { Section, SectionHeading, IconTile } from "@/components/landing/section";
import type { HowItWorksContent } from "@/lib/landing-content";

const STEP_ICONS = [UserRound, WandSparkles, Users];

export function HowItWorksSection({ content }: { content: HowItWorksContent }) {
  return (
    <Section id="how-it-works">
      <SectionHeading align="center" kicker={content.kicker} heading={content.heading} />

      <ol className="mt-14 divide-y divide-border border-t border-border sm:mt-16 md:grid md:grid-cols-3 md:divide-y-0 md:divide-x md:border-b">
        {content.steps.map((step, i) => (
          <li
            key={step._key}
            className="flex flex-col gap-4 py-8 md:px-8 md:py-10 first:md:pl-0 last:md:pr-0"
          >
            <div className="flex items-center gap-3">
              <span className="font-serif text-4xl leading-none text-muted-foreground/50">
                {step.number}
              </span>
              <IconTile icon={STEP_ICONS[i % STEP_ICONS.length]} size="sm" />
            </div>
            <h3 className="font-serif text-2xl leading-snug text-foreground">{step.title}</h3>
            <p className="text-base leading-relaxed text-pretty text-muted-foreground">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
```

What changed: the 3 hover-lift bordered cards (`rounded-card border border-border bg-surface p-8 ... hover:-translate-y-1 hover:border-accent hover:shadow-paper`) are replaced by a rule-divided list — `divide-y` + `border-t` stacked below `md:`, `divide-x` + `border-b` 3-column grid at `md:` and above (same breakpoint convention as the grid fixes from the prior refactor pass — `md:`, not `sm:`, avoids a cramped 3-narrow-column state between 640–767px). `step.number` (e.g. `"01"`) now renders as a large serif numeral instead of inside an `Eyebrow`. `IconTile` uses the new `size="sm"` from Task 1, positioned secondary to the numeral rather than the card's focal point. `Eyebrow` import removed (no longer used in this file).

- [ ] **Step 2: Verify**

Run both verification commands. Both must be clean.

- [ ] **Step 3: Manual check**

Check How It Works at all 6 breakpoints:
- Below 768px: stacked rows separated by a horizontal rule, no card borders/shadows/hover-lift.
- At 768px+: 3 equal columns separated by vertical rules, no stuck-2-column state at any width in the 768–1023px range (this was the exact bug fixed in the prior pass — confirm the redesign didn't reintroduce it).

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/how-it-works-section.tsx
git commit -m "feat: redesign how-it-works as rule-divided numbered list"
```

---

### Task 4: Dossier redesign

**Files:**
- Modify: `src/components/landing/dossier-section.tsx`

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/components/landing/dossier-section.tsx` with:

```tsx
import { FileText } from "lucide-react";
import { Section, SectionHeading, Eyebrow, IconTile } from "@/components/landing/section";
import { SeasonTag } from "@/components/landing/season-tag";
import type { DossierContent } from "@/lib/landing-content";

export function DossierSection({ content }: { content: DossierContent }) {
  return (
    <Section id="dossier">
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <SectionHeading kicker={content.kicker} heading={content.heading} body={content.body} />

        <div className="overflow-hidden rounded-card border border-border bg-card shadow-paper">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-7 py-6">
            <span className="flex items-center gap-3.5">
              <IconTile icon={FileText} size="sm" />
              <span className="font-serif text-lg text-foreground">{content.cardTitle}</span>
            </span>
            <SeasonTag season={content.season} />
          </div>

          <dl className="divide-y divide-border">
            {content.rows.map((row) => (
              <div
                key={row._key}
                className="flex flex-wrap justify-between gap-x-6 gap-y-1 px-7 py-4 text-sm"
              >
                <dt className="min-w-0 text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 text-right text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className="border-t border-border px-7 py-6">
            <div className="flex items-center justify-between">
              <Eyebrow>{content.completionLabel}</Eyebrow>
              <span className="text-label font-semibold text-foreground">
                {content.completionPercent}%
              </span>
            </div>
            {/* ponytail: decorative bar — the percentage above already carries the value. */}
            <div className="mt-3 h-px overflow-hidden bg-border" aria-hidden="true">
              {/* Inline width — Tailwind cannot generate a class from a runtime value. */}
              <div className="h-full bg-accent" style={{ width: `${content.completionPercent}%` }} />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
```

What changed: this is the one section that keeps a real contained card (a data table genuinely needs a bounded surface) — but now uses the app's canonical recipe exactly (`bg-card` instead of `bg-surface`, `shadow-paper` always on instead of `hover:shadow-paper`, dropped the now-pointless `transition-shadow duration-200 ease-editorial` since there's no more hover state to transition to on a non-interactive card). Row padding tightened `py-5` → `py-4`. Completion bar changed from a thick `h-1 rounded-full` bar to a thin `h-px` line (no `rounded-full` needed at 1px height). `IconTile` uses `size="sm"` from Task 1 instead of the old `className="size-10"` override.

- [ ] **Step 2: Verify**

Run both verification commands. Both must be clean.

- [ ] **Step 3: Manual check**

Check Dossier at all 6 breakpoints: card renders with visible shadow at rest (not just on hover — there's no hover state anymore), rows don't wrap awkwardly, the thin progress line reflects `completionPercent` correctly (compare against the percentage text above it).

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/dossier-section.tsx
git commit -m "feat: migrate dossier card to canonical app card recipe, tighten rhythm"
```

---

### Task 5: Dupe Hunter redesign

**Files:**
- Modify: `src/components/landing/dupe-hunter-section.tsx`

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/components/landing/dupe-hunter-section.tsx` with:

```tsx
import { BadgeCheck, Camera } from "lucide-react";
import { Section, SectionHeading, Eyebrow } from "@/components/landing/section";
import { cn } from "@/lib/utils";
import type { DupeCard, DupeHunterContent } from "@/lib/landing-content";

function DupeColumn({ card, isMatch }: { card: DupeCard; isMatch?: boolean }) {
  return (
    <div className={cn("flex flex-1 min-w-0 flex-col gap-3 p-8 sm:p-10", isMatch && "bg-accent-soft/50")}>
      <Eyebrow icon={isMatch ? BadgeCheck : Camera} className={isMatch ? "text-ink" : undefined}>
        {card.label}
      </Eyebrow>
      <p className="font-serif text-xl leading-snug text-balance text-foreground">{card.title}</p>
      <p
        className={cn(
          "mt-auto font-serif text-3xl",
          isMatch ? "text-foreground" : "text-muted-foreground line-through",
        )}
      >
        {card.price}
      </p>
    </div>
  );
}

export function DupeHunterSection({ content }: { content: DupeHunterContent }) {
  return (
    <Section id="dupe-hunter">
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <div className="order-last flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-paper sm:flex-row sm:divide-x sm:divide-y-0 lg:order-first">
          <DupeColumn card={content.inspiration} />
          <DupeColumn card={content.milaMatch} isMatch />
        </div>

        <SectionHeading kicker={content.kicker} heading={content.heading} body={content.body} />
      </div>
    </Section>
  );
}
```

What changed: the two `DupeRow`s (previously stacked with `divide-y` inside one card) become `DupeColumn`s laid out side-by-side (`sm:flex-row sm:divide-x sm:divide-y-0`) — a diptych split by a vertical rule instead of a stacked comparison. Below `sm:`, they still stack with a horizontal divider (same as before, comparison remains readable on narrow phones). `min-w-0` carries over from the prior refactor's overflow fix, now on `DupeColumn` directly since it's a flex item in a row on `sm:`+. The card itself keeps `shadow-paper` as a base (was `hover:shadow-paper` + transition before — same reasoning as Task 4, this isn't an interactive hover card).

- [ ] **Step 2: Verify**

Run both verification commands. Both must be clean.

- [ ] **Step 3: Manual check**

Check Dupe Hunter at all 6 breakpoints:
- Below 640px (`sm`): the two columns stack vertically, divided by a horizontal rule.
- At 640px+: side by side, divided by a vertical rule, both columns equal width (`flex-1`).
- Long titles/prices don't force the row to overflow horizontally (the `min-w-0` fix).

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/dupe-hunter-section.tsx
git commit -m "feat: redesign dupe-hunter comparison as side-by-side diptych"
```

---

### Task 6: Testimonials redesign

**Files:**
- Modify: `src/components/landing/testimonials-section.tsx`

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/components/landing/testimonials-section.tsx` with:

```tsx
import { Quote } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { SeasonTag } from "@/components/landing/season-tag";
import type { Testimonial } from "@/lib/landing-content";

export function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  return (
    <Reveal>
      <ul className="mt-14 divide-y divide-border border-t border-border sm:mt-16 md:grid md:grid-cols-3 md:divide-y-0 md:divide-x md:border-b">
        {testimonials.map((t) => (
          <li
            key={t._key}
            className="py-8 md:px-8 md:py-10 first:md:pl-0 last:md:pr-0"
          >
            <figure className="flex h-full flex-col gap-4">
              <Quote
                className="size-8 shrink-0 fill-accent/20 text-accent"
                strokeWidth={1}
                aria-hidden="true"
              />
              <blockquote className="flex-1 font-serif text-lg leading-snug text-pretty text-foreground">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
                {t.name} <SeasonTag season={t.season} />
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
```

What changed: same rule-divided list pattern as How It Works (Task 3) — `divide-y`/`border-t` stacked below `md:`, `divide-x`/`border-b` 3-column grid at `md:`+. Drops `rounded-card border border-border bg-surface p-8 ... hover:-translate-y-1 hover:border-accent hover:shadow-paper` entirely — the 3rd duplicate of the hand-rolled card is gone. Quote icon enlarged (`size-5` → `size-8`, `strokeWidth={1.5}` → `1`) to read as an editorial pull-quote glyph rather than a small card decoration. `<figure>`/`<figcaption>` kept (valid HTML — `figcaption` must be inside `figure`) even though the card chrome is gone.

- [ ] **Step 2: Verify**

Run both verification commands. Both must be clean.

- [ ] **Step 3: Manual check**

Check Testimonials at all 6 breakpoints, same criteria as Task 3 (no stuck-2-column state 768–1023px, clean stack below 768px). Confirm it still sits visually as part of the Community section above it (it's rendered as `CommunitySection`'s `children`, unchanged composition).

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/testimonials-section.tsx
git commit -m "feat: redesign testimonials as rule-divided quote wall"
```

---

### Task 7: Final CTA redesign

**Files:**
- Modify: `src/components/landing/final-cta-section.tsx`

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/components/landing/final-cta-section.tsx` with:

```tsx
import { Lock } from "lucide-react";
import { Section, SectionHeading } from "@/components/landing/section";
import { CtaButton } from "@/components/landing/cta-button";
import type { FinalCtaContent } from "@/lib/landing-content";

export function FinalCtaSection({ content }: { content: FinalCtaContent }) {
  return (
    <Section id="start" className="relative isolate text-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -bottom-40 -z-10 mx-auto h-96 max-w-xl rounded-full bg-accent/15 blur-[130px]"
      />
      <SectionHeading
        align="center"
        heading={content.heading}
        body={content.body}
        className="mx-auto max-w-2xl"
      />
      <div className="mt-10 flex justify-center">
        <CtaButton className="w-full sm:w-auto" />
      </div>
      <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3" aria-hidden="true" /> {content.privacyNote}
      </p>
    </Section>
  );
}
```

What changed: this section previously bypassed `Section` entirely, hand-rolling `<Reveal id="start" className="relative isolate scroll-mt-16 border-t border-border">` + its own `atelier-container py-28 text-center sm:py-36 lg:py-44` + a third, one-off heading scale (`text-[clamp(2.5rem,6vw,4rem)] leading-[1]`). It now renders through `Section` (which already provides `id`, `scroll-mt-16`, `border-t border-border`, `atelier-container`, and the standard `py-20 sm:py-24` padding every other section uses) and `SectionHeading` (the one shared heading scale). This intentionally reduces Final CTA's padding from its previous one-off `py-28/36/44` down to the same `py-20/24` as every other section — that consistency is the point of the fix, not an oversight. `relative isolate text-center` is passed as `Section`'s `className`, which lands on the same inner container div the decorative blur and content sit inside, so the blur's `absolute` positioning still resolves correctly against that container.

- [ ] **Step 2: Verify**

Run both verification commands. Both must be clean.

- [ ] **Step 3: Manual check**

Check Final CTA at all 6 breakpoints: heading uses the same visual scale as How It Works / Dossier / Dupe Hunter / Community headings (not visibly larger or smaller than them anymore), decorative background blur still positions correctly behind the content, CTA button and privacy note remain centered.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/final-cta-section.tsx
git commit -m "feat: migrate final-cta to shared Section/SectionHeading, fixing its one-off scale"
```

---

### Task 8: Header CTA + CtaButton cleanup

**Files:**
- Modify: `src/components/landing/site-header.tsx`
- Modify: `src/components/landing/cta-button.tsx`

- [ ] **Step 1: Update the header nav CTA**

In `src/components/landing/site-header.tsx`, replace:

```tsx
          <Button
            asChild
            variant="outline"
            size="sm"
            className="rounded-full px-4 text-label uppercase tracking-label sm:h-11 sm:px-5"
          >
            <Link to={destination}>{label}</Link>
          </Button>
```

with:

```tsx
          <Button asChild variant="outline" size="pill">
            <Link to={destination}>{label}</Link>
          </Button>
```

- [ ] **Step 2: Update `cta-button.tsx`**

Replace the full contents of `src/components/landing/cta-button.tsx` with:

```tsx
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CtaButton({ className }: { className?: string }) {
  return (
    <Button asChild size="pill-lg" className={cn(className)}>
      <Link to="/login">
        Get your first look
        <ArrowRight className="ml-2 size-4 text-accent" aria-hidden="true" />
      </Link>
    </Button>
  );
}
```

Both changes drop a hand-written override in favor of a real `Button` size (`pill` already existed and matches the header CTA's intended look exactly; `pill-lg` was added in Task 1 and matches `CtaButton`'s current look exactly — visually nothing changes here, this is pure cleanup).

- [ ] **Step 3: Verify**

Run both verification commands. Both must be clean.

- [ ] **Step 4: Manual check**

Compare the header's sign-in/dashboard button and the hero/final-CTA "Get your first look" button side by side at 1440px — header button should look identical to before (small pill), CTA button should look identical to before (larger uppercase pill). This task is a refactor with zero intended visual change.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/site-header.tsx src/components/landing/cta-button.tsx
git commit -m "refactor: drop ad hoc button overrides in favor of pill/pill-lg sizes"
```

---

### Task 9: Full-page verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run both verification commands one final time from repo root. Both must be clean.

- [ ] **Step 2: No palette drift check**

```bash
git diff src/styles.css
```
Expected: only the additive `.landing-hero-heading` block from Task 1 appears as new lines inside `@layer components`. Zero changes inside any `:root {}` or `.dark {}` block. If anything else shows up, stop and investigate before proceeding.

- [ ] **Step 3: Full responsive pass**

With the dev server running (`nvm use 22 && npm run dev` → https://localhost:8080/), load `/` fresh and scroll through the entire page at 320, 375, 768, 1024, 1440, 1920px. Confirm:
- No section has a stuck-2-column layout at any width in the 768–1023px range.
- No horizontal scroll/overflow at any width.
- Mobile nav (hamburger, added in the prior refactor pass) still opens/closes correctly and its links still scroll to the right sections.
- Every section's heading reads at one of exactly two sizes across the whole page: the hero's (biggest) or the shared section-heading size (everything else, now including Final CTA).

- [ ] **Step 4: Reduced-motion check**

In the browser, enable "prefers reduced motion" (OS-level or via devtools emulation) and reload `/`. Confirm all sections still appear (no missing content) and entrance animations are instant/disabled rather than skipped-but-broken — this exercises `Reveal`'s existing `useReducedMotion` handling, which none of the tasks above touched, but the JSX restructuring in Tasks 2/3/6 changed what's inside `Reveal`/`Section` and could theoretically have broken the wrapping.

- [ ] **Step 5: Final commit (if anything uncommitted remains)**

```bash
git status --short
```
If clean, nothing to do. If anything is unstaged (e.g. a fix made during manual verification), stage and commit it with a message describing what was fixed.

---

## Self-review notes (from plan authoring)

- **Spec coverage:** every numbered item in the spec's "Foundation changes" and "Section-by-section redesign" sections maps to a task above (Foundation → Task 1; Hero → Task 2; How It Works → Task 3; Dossier → Task 4; Dupe Hunter → Task 5; Community/Testimonials → Task 6 (Community itself needs no file change, confirmed unchanged in spec); Final CTA → Task 7; Header/Footer → Task 8 (Footer needs no change, confirmed clean in the prior audit)).
- **Corrected during planning:** the spec's Foundation §4 originally said both the header CTA and `cta-button.tsx` should use the existing `size="pill"`. On inspection, `cta-button.tsx` is the primary hero/final-CTA conversion button and is deliberately bigger than the header's secondary nav CTA — forcing both to `pill` would have shrunk the primary CTA. Fixed by adding a new `pill-lg` size instead (Task 1 Step 2) and updated the spec file to match before writing this plan.
- **Type consistency:** `IconTile`'s new `size` prop (`"sm" | "md"`, Task 1) is used identically in Tasks 3 and 4. `Button`'s new `"pill-lg"` size (Task 1) is used identically in Task 8. `.landing-hero-heading` (Task 1) is used only in Task 2, its sole consumer.
