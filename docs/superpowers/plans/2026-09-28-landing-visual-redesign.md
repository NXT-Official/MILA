# Landing Page Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the landing page real generated imagery (10 images) in every section that currently describes a visual product with none, break the repeated one-template section rhythm with two full-bleed moments, and add section-appropriate motion (staggered reveals, image hover-lift, a full-bleed background drift) — all inside the existing, already-compliant `docs/DESIGN.md` token system.

**Architecture:** One one-off script generates 10 static JPEGs via the app's existing OpenRouter `meta/muse-image` pipeline into `public/landing/`. `Reveal` (`src/components/landing/reveal.tsx`) gains an opt-in `stagger` mode plus a new `RevealItem` child component; `Section` forwards a new `stagger` prop. Six landing section components get direct edits: one image each for Dossier/Daily Palette/Concierge, two for Dupe Hunter, a full-bleed 4-image staggered grid for Feed (replacing its current badge), a full-bleed background photo + drift for Final CTA, and a subtle scale-in for the Hero's existing photo. How It Works gets a staggered step reveal (no new image — it's a process section, not a visual-product one).

**Tech Stack:** Framer Motion (already a dependency), Tailwind v4 (existing `shadow-paper`/`shadow-raised`/`ease-editorial` tokens — no new tokens), OpenRouter Images API (already used in production by `src/lib/openrouter-image.server.ts`).

**Deviations from spec** (`docs/superpowers/specs/2026-09-28-landing-visual-redesign-design.md`):
- Pricing section motion polish (staggered cards + hover-lift) is **dropped**. `PricingCard` (`src/components/pricing/pricing-card.tsx`) is shared with the authenticated in-app pricing route (`src/routes/_authenticated/_app/pricing.tsx`) — touching it would reach into authenticated-app surface, which this pass's own non-goals explicitly rule out. Pricing section ships unchanged.
- Final CTA's background scrim is a uniform `bg-canvas/90` over the whole photo rather than a directional (left-text/right-photo) treatment — simpler, guarantees contrast everywhere regardless of exact photo composition, and the generated photo's prompt is written to work as a soft atmospheric background rather than a precisely-composed split layout.

---

### Task 1: Generate the 10 landing images

**Files:**
- Create: `scripts/generate-landing-images.ts`
- Create (by running the script): `public/landing/dossier-example.jpg`, `palette-flatlay.jpg`, `concierge-garment.jpg`, `dupe-inspiration.jpg`, `dupe-match.jpg`, `feed-1.jpg`, `feed-2.jpg`, `feed-3.jpg`, `feed-4.jpg`, `final-cta-bg.jpg`

- [ ] **Step 1: Write the script**

```ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
const IMAGE_MODEL = "meta/muse-image";
const CONCURRENCY = 3;

const IMAGES: Array<{ file: string; prompt: string }> = [
  {
    file: "dossier-example.jpg",
    prompt: `Create a realistic full-body luxury fashion editorial photograph.

Outfit: A "True Summer" cool, muted color palette outfit — soft blue-grey trousers, a dusty rose blouse, and cool taupe accessories. Elegant, understated silhouette.

Presentation:
Show one adult model from head to toe.
The complete outfit and shoes must be visible.
Natural realistic proportions.
Accurate fabric textures and garment colors.
Elegant neutral studio background.
Soft professional editorial lighting.
Single subject, centered composition.
No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "palette-flatlay.jpg",
    prompt: `Create a realistic overhead flat-lay editorial photograph of three fashion items arranged neatly on a soft neutral surface: a camel-colored wool sweater (base), a deep berry-red silk scarf (statement), and a gold statement necklace (accent). Soft, even studio lighting. Elegant, minimal composition with generous negative space. No text, no captions, no logos, no watermark.`,
  },
  {
    file: "concierge-garment.jpg",
    prompt: `Create a realistic close-up editorial photograph of a black wool tailored coat laid flat, paired with a pair of gold hoop earrings placed on the lapel. Soft, warm studio lighting. Shallow depth of field. Elegant, minimal composition. No text, no captions, no logos, no watermark.`,
  },
  {
    file: "dupe-inspiration.jpg",
    prompt: `Create a realistic full-body luxury fashion editorial photograph of one adult model wearing a camel-colored wool-blend maxi coat, floor length, cinched waist, over a simple black outfit. Elegant neutral studio background. Soft professional editorial lighting. Single subject, centered composition. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "dupe-match.jpg",
    prompt: `Create a realistic full-body luxury fashion editorial photograph of one adult model wearing a camel-colored wool-blend maxi coat, floor length, cinched waist, nearly identical silhouette and color to a designer original, over a simple black outfit. Elegant neutral studio background. Soft professional editorial lighting. Single subject, centered composition. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "feed-1.jpg",
    prompt: `Create a realistic square-format full-body luxury fashion editorial photograph of one adult model in a warm autumn palette outfit — olive green trousers, a cream turtleneck, and brown leather boots. Elegant neutral studio background. Soft professional editorial lighting. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "feed-2.jpg",
    prompt: `Create a realistic square-format full-body luxury fashion editorial photograph of one adult model in a cool winter palette outfit — a charcoal wool coat over a crisp white shirt and black trousers. Elegant neutral studio background. Soft professional editorial lighting. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "feed-3.jpg",
    prompt: `Create a realistic square-format full-body luxury fashion editorial photograph of one adult model in a soft spring palette outfit — a light coral sundress and tan sandals. Elegant neutral studio background. Soft professional editorial lighting. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "feed-4.jpg",
    prompt: `Create a realistic square-format full-body luxury fashion editorial photograph of one adult model in a deep summer palette outfit — a navy blazer, blush trousers, and silver jewelry. Elegant neutral studio background. Soft professional editorial lighting. No collage, no text, no captions, no logos, no watermark.`,
  },
  {
    file: "final-cta-bg.jpg",
    prompt: `Create a realistic wide landscape-format luxury fashion editorial photograph: one adult model in a complete, elegant styled outfit, soft-focus neutral background, muted warm tones, gentle even lighting, composition suitable for a text overlay treatment. No collage, no text, no captions, no logos, no watermark.`,
  },
];

async function generateImage(prompt: string): Promise<Buffer> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const res = await fetch(OPENROUTER_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, output_format: "jpeg" }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter image request failed (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenRouter did not return an image.");
  return Buffer.from(b64, "base64");
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: limit }, async () => {
    let item: T | undefined;
    while ((item = queue.shift())) {
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const outDir = join(process.cwd(), "public", "landing");
  mkdirSync(outDir, { recursive: true });

  await runWithConcurrency(IMAGES, CONCURRENCY, async ({ file, prompt }) => {
    console.log(`Generating ${file}...`);
    const buffer = await generateImage(prompt);
    writeFileSync(join(outDir, file), buffer);
    console.log(`Saved ${file} (${buffer.length} bytes)`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `nvm use 22 && bun run scripts/generate-landing-images.ts`
Expected: 10 `Saved <file> (N bytes)` log lines, no errors. This costs real OpenRouter API usage — it's a one-time generation, not a recurring job.

- [ ] **Step 3: Verify**

Run: `ls -la public/landing/` — confirm all 10 files exist and are non-trivial size (each should be tens to a few hundred KB, not 0 bytes).

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-landing-images.ts public/landing/
git commit -m "feat: generate landing page editorial imagery via OpenRouter"
```

---

### Task 2: `Reveal` gains a `stagger` mode and `RevealItem`

**Files:**
- Modify: `src/components/landing/reveal.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { motion, useReducedMotion, type Variants } from "framer-motion";

export function Reveal({
  children,
  className,
  id,
  "aria-label": ariaLabel,
  stagger = false,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  "aria-label"?: string;
  stagger?: boolean;
}) {
  const reduce = useReducedMotion() ?? false;
  const sectionVariants: Variants = stagger
    ? { hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : 0.1 } } }
    : {
        hidden: { y: reduce ? 0 : 16 },
        visible: { y: 0, transition: { duration: reduce ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] } },
      };

  return (
    <motion.section
      id={id}
      aria-label={ariaLabel}
      className={className}
      variants={sectionVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
    >
      {children}
    </motion.section>
  );
}

export function RevealItem({
  children,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "li";
}) {
  const reduce = useReducedMotion() ?? false;
  const itemVariants: Variants = {
    hidden: { y: reduce ? 0 : 12, opacity: reduce ? 1 : 0 },
    visible: { y: 0, opacity: 1, transition: { duration: reduce ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] } },
  };
  const MotionTag = as === "li" ? motion.li : motion.div;
  return (
    <MotionTag className={className} variants={itemVariants}>
      {children}
    </MotionTag>
  );
}
```

Non-stagger behavior (the `hidden`/`visible` object in the `else` branch) is byte-identical to the current file — this is additive, not a rewrite of existing behavior. Every current `Reveal` consumer that doesn't pass `stagger` continues to animate exactly as before.

- [ ] **Step 2: Typecheck**

Run: `nvm use 22 && bun run typecheck`
Expected: PASS (new exports, nothing consumes `stagger`/`RevealItem` yet).

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/reveal.tsx
git commit -m "feat: add stagger mode and RevealItem to the Reveal motion primitive"
```

---

### Task 3: `Section` forwards `stagger` to `Reveal`

**Files:**
- Modify: `src/components/landing/section.tsx:5-21`

- [ ] **Step 1: Update the `Section` function**

Replace lines 5-21 with:

```tsx
export function Section({
  id,
  className,
  children,
  stagger,
  "aria-label": ariaLabel,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
  stagger?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Reveal
      id={id}
      aria-label={ariaLabel}
      stagger={stagger}
      className="scroll-mt-16 border-t border-border"
    >
      <div className={cn("atelier-container py-20 sm:py-24", className)}>{children}</div>
    </Reveal>
  );
}
```

Nothing else in the file changes (`Eyebrow`, `IconTile`, `SectionHeading` stay exactly as-is).

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck` — expected PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/section.tsx
git commit -m "feat: Section forwards an optional stagger prop to Reveal"
```

---

### Task 4: Hero photo scale-in

**Files:**
- Modify: `src/components/landing/hero-section.tsx`

- [ ] **Step 1: Add the motion import and reduced-motion hook**

Change:
```tsx
import { Sparkles } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
```
to:
```tsx
import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/landing/reveal";
```

Change:
```tsx
export function HeroSection({ content }: { content: HeroContent }) {
  const { preview } = content;
```
to:
```tsx
export function HeroSection({ content }: { content: HeroContent }) {
  const { preview } = content;
  const reduce = useReducedMotion() ?? false;
```

- [ ] **Step 2: Replace the `<img>` with a `motion.img`**

Change:
```tsx
              <img
                src="/hero-style-sheet.png"
                alt="Identity-locked 5-view style sheet — face close-up, front, back, left profile, and right profile"
                width={1686}
                height={1128}
                className="w-full rounded-card border border-border shadow-paper"
              />
```
to:
```tsx
              <motion.img
                src="/hero-style-sheet.png"
                alt="Identity-locked 5-view style sheet — face close-up, front, back, left profile, and right profile"
                width={1686}
                height={1128}
                loading="eager"
                fetchPriority="high"
                className="w-full rounded-card border border-border shadow-paper"
                initial={reduce ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              />
```

Nothing else in the file changes.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` — expected PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/hero-section.tsx
git commit -m "feat: subtle scale-in entrance on the hero style-sheet photo"
```

---

### Task 5: Staggered How It Works steps

**Files:**
- Modify: `src/components/landing/how-it-works-section.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { UserRound, WandSparkles, Users } from "lucide-react";
import { Section, SectionHeading, IconTile } from "@/components/landing/section";
import { RevealItem } from "@/components/landing/reveal";
import type { HowItWorksContent } from "@/lib/landing-content";

const STEP_ICONS = [UserRound, WandSparkles, Users];

export function HowItWorksSection({ content }: { content: HowItWorksContent }) {
  return (
    <Section id="how-it-works" stagger>
      <SectionHeading align="center" heading={content.heading} />

      <ol className="mt-14 divide-y divide-border border-t border-border sm:mt-16 md:grid md:grid-cols-3 md:divide-y-0 md:divide-x md:border-b">
        {content.steps.map((step, i) => (
          <RevealItem
            key={step._key}
            as="li"
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
          </RevealItem>
        ))}
      </ol>
    </Section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck` — expected PASS.

- [ ] **Step 3: Manual check**

`bun run dev`, open `/`, scroll to "Three steps to dressed" with browser devtools' "Emulate CSS prefers-reduced-motion: no-preference" (default) — the three steps should appear in a quick left-to-right/top-to-bottom sequence, not all at once. Then enable "prefers-reduced-motion: reduce" in devtools and reload — all three should appear together instantly, no stagger, no individual rise.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/how-it-works-section.tsx
git commit -m "feat: stagger the three How It Works steps instead of revealing as one block"
```

---

### Task 6: Style Dossier gets its example photo

**Files:**
- Modify: `src/components/landing/dossier-section.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { FileText } from "lucide-react";
import { Section, SectionHeading, Eyebrow, IconTile } from "@/components/landing/section";
import { SeasonTag } from "@/components/landing/season-tag";
import type { DossierContent } from "@/lib/landing-content";

export function DossierSection({ content }: { content: DossierContent }) {
  return (
    <Section id="dossier">
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <div>
          <SectionHeading heading={content.heading} body={content.body} />
          <img
            src="/landing/dossier-example.jpg"
            alt="Editorial photograph of a True Summer palette outfit — soft blue-grey and dusty rose"
            width={640}
            height={800}
            loading="lazy"
            className="mt-8 aspect-4/5 w-full max-w-sm rounded-card border border-border object-cover shadow-paper transition-shadow duration-200 ease-editorial hover:shadow-raised"
          />
        </div>

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
              <div
                className="h-full bg-accent"
                style={{ width: `${content.completionPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
```

Only change from the current file: the first grid column is now a `<div>` wrapping `SectionHeading` plus the new `<img>`; the dossier-card column (second grid child) is untouched byte-for-byte.

- [ ] **Step 2: Verify the image exists**

`ls public/landing/dossier-example.jpg` — must exist from Task 1. If it doesn't, stop and re-run Task 1 before proceeding.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` — expected PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/dossier-section.tsx
git commit -m "feat: add example editorial photo to the Style Dossier section"
```

---

### Task 7: Daily Palette gets its flat-lay photo

**Files:**
- Modify: `src/components/landing/daily-palette-section.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { Section, SectionHeading } from "@/components/landing/section";

const SWATCHES = [
  { label: "Base Layer", hex: "#D8C4A0" },
  { label: "Statement", hex: "#8B4A62" },
  { label: "Accent Pop", hex: "#C9A227" },
];

export function DailyPaletteSection() {
  return (
    <Section id="palette">
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <SectionHeading
          heading="A new color mix, every morning."
          body="Three colors pulled fresh from your season each day — base, statement, and accent — so you never second-guess what goes together."
        />
        <div className="flex flex-col items-center gap-8">
          <img
            src="/landing/palette-flatlay.jpg"
            alt="Flat-lay of camel, deep berry, and gold garments — one day's color palette"
            width={640}
            height={480}
            loading="lazy"
            className="w-full max-w-md rounded-card border border-border object-cover shadow-paper transition-shadow duration-200 ease-editorial hover:shadow-raised"
          />
          <div className="flex justify-center gap-4">
            {SWATCHES.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-2">
                <span
                  className="size-16 rounded-full border-2 border-card shadow-sm sm:size-20"
                  style={{ backgroundColor: s.hex }}
                  aria-hidden="true"
                />
                <span className="text-micro uppercase tracking-label text-muted-foreground">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
```

- [ ] **Step 2: Verify the image exists**

`ls public/landing/palette-flatlay.jpg` — must exist from Task 1.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` — expected PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/daily-palette-section.tsx
git commit -m "feat: add flat-lay photo to the Daily Palette section"
```

---

### Task 8: Concierge gets its garment photo

**Files:**
- Modify: `src/components/landing/concierge-section.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { Section, SectionHeading } from "@/components/landing/section";

const EXCHANGE = [
  {
    role: "user" as const,
    text: "What do I pair with this coat for a dinner tonight?",
  },
  {
    role: "assistant" as const,
    text: "Swap the sneakers for your black block heels, and add the gold hoops from your dossier — keeps the silhouette elongated under low light.",
  },
];

export function ConciergeSection() {
  return (
    <Section id="concierge">
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <SectionHeading
          heading="Ask Mila anything, anytime."
          body="Not sure about a pairing? Stuck between two looks? Mila remembers your dossier and every look you've saved — just ask."
        />
        <div className="space-y-6">
          <img
            src="/landing/concierge-garment.jpg"
            alt="Close-up of a black wool coat and gold hoop earrings — the items Mila is discussing"
            width={640}
            height={480}
            loading="lazy"
            className="w-full rounded-card border border-border object-cover shadow-paper transition-shadow duration-200 ease-editorial hover:shadow-raised"
          />
          <div className="space-y-3">
            {EXCHANGE.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-4 py-3 text-sm text-surface"
                    : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm text-foreground"
                }
              >
                {m.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
```

- [ ] **Step 2: Verify the image exists**

`ls public/landing/concierge-garment.jpg` — must exist from Task 1.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` — expected PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/concierge-section.tsx
git commit -m "feat: add garment photo to the Concierge section"
```

---

### Task 9: Dupe Hunter gets both comparison photos

**Files:**
- Modify: `src/components/landing/dupe-hunter-section.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { BadgeCheck, Camera } from "lucide-react";
import { Section, SectionHeading, Eyebrow } from "@/components/landing/section";
import { cn } from "@/lib/utils";
import type { DupeCard, DupeHunterContent } from "@/lib/landing-content";

function DupeColumn({
  card,
  image,
  alt,
  isMatch,
}: {
  card: DupeCard;
  image: string;
  alt: string;
  isMatch?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 min-w-0 flex-col gap-3 p-8 sm:p-10",
        isMatch && "bg-accent-soft/50",
      )}
    >
      <img
        src={image}
        alt={alt}
        width={480}
        height={600}
        loading="lazy"
        className="aspect-4/5 w-full rounded-panel border border-border object-cover"
      />
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
        <div className="order-last flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-paper transition-shadow duration-200 ease-editorial hover:shadow-raised sm:flex-row sm:divide-x sm:divide-y-0 lg:order-first">
          <DupeColumn
            card={content.inspiration}
            image="/landing/dupe-inspiration.jpg"
            alt="The inspiration piece — a camel wool-blend maxi coat"
          />
          <DupeColumn
            card={content.milaMatch}
            image="/landing/dupe-match.jpg"
            alt="Mila's match — a near-identical camel maxi coat"
            isMatch
          />
        </div>

        <SectionHeading heading={content.heading} body={content.body} />
      </div>
    </Section>
  );
}
```

- [ ] **Step 2: Verify the images exist**

`ls public/landing/dupe-inspiration.jpg public/landing/dupe-match.jpg` — both must exist from Task 1.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` — expected PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/dupe-hunter-section.tsx
git commit -m "feat: add comparison photos to the Dupe Hunter section"
```

---

### Task 10: Feed becomes a full-bleed, staggered 4-photo grid

**Files:**
- Modify: `src/components/landing/feed-section.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { Reveal, RevealItem } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section";

const FEED_IMAGES = [
  { src: "/landing/feed-1.jpg", alt: "Outfit post — warm autumn palette, olive and cream" },
  { src: "/landing/feed-2.jpg", alt: "Outfit post — cool winter palette, charcoal and white" },
  { src: "/landing/feed-3.jpg", alt: "Outfit post — soft spring palette, coral sundress" },
  { src: "/landing/feed-4.jpg", alt: "Outfit post — deep summer palette, navy and blush" },
];

export function FeedSection() {
  return (
    <Reveal id="feed" stagger className="scroll-mt-16 border-t border-border py-20 sm:py-24">
      <div className="atelier-container">
        <SectionHeading
          align="center"
          heading="Post today's fit. See everyone else's."
          body="One photo, tagged automatically — every piece becomes shoppable for the whole community."
        />
      </div>

      <div className="mt-14 grid grid-cols-2 gap-1 sm:mt-16 sm:grid-cols-4 sm:gap-1.5">
        {FEED_IMAGES.map((img) => (
          <RevealItem key={img.src} className="aspect-square overflow-hidden">
            <img
              src={img.src}
              alt={img.alt}
              width={480}
              height={480}
              loading="lazy"
              className="size-full object-cover transition-transform duration-200 ease-editorial hover:scale-[1.03]"
            />
          </RevealItem>
        ))}
      </div>
    </Reveal>
  );
}
```

Note this section no longer uses the shared `Section` wrapper (it needs the image grid to escape `atelier-container`'s max-width for a genuine full-bleed row) — it reconstructs the same `scroll-mt-16 border-t border-border py-20 sm:py-24` treatment directly on `Reveal`, with an inner `atelier-container` div wrapping only the heading. The `Camera` icon and the "Daily Drop — live now" badge are removed entirely, replaced by the photo grid itself.

- [ ] **Step 2: Verify the images exist**

`ls public/landing/feed-1.jpg public/landing/feed-2.jpg public/landing/feed-3.jpg public/landing/feed-4.jpg` — all four must exist from Task 1.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` — expected PASS (confirms the removed `Camera` import doesn't leave a lint/type issue — there is none since `Camera` is a value import, but check lint too).

- [ ] **Step 4: Lint**

Run: `bun run lint` — expected PASS, confirms no unused-import warning was left behind.

- [ ] **Step 5: Manual check**

`bun run dev`, open `/`, scroll to the feed section. Confirm the 4-photo grid spans the full browser width (edge to edge, not constrained to the same width as sections above/below it), and the four tiles animate in with a short stagger on scroll into view.

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/feed-section.tsx
git commit -m "feat: replace Feed section's badge with a full-bleed, staggered 4-photo grid"
```

---

### Task 11: Final CTA gets a full-bleed background photo

**Files:**
- Modify: `src/components/landing/final-cta-section.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { Lock } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section";
import { CtaButton } from "@/components/landing/cta-button";
import type { FinalCtaContent } from "@/lib/landing-content";

export function FinalCtaSection({ content }: { content: FinalCtaContent }) {
  const reduce = useReducedMotion() ?? false;

  return (
    <Reveal
      id="start"
      className="relative isolate scroll-mt-16 overflow-hidden border-t border-border text-center"
    >
      <motion.img
        src="/landing/final-cta-bg.jpg"
        alt=""
        aria-hidden="true"
        width={1600}
        height={900}
        loading="lazy"
        className="absolute inset-0 -z-10 size-full object-cover"
        initial={reduce ? false : { scale: 1.06 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-canvas/90" />

      <div className="atelier-container py-20 sm:py-24">
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
      </div>
    </Reveal>
  );
}
```

This replaces the old decorative champagne blur blob entirely with the real photo + scrim. Like Task 10, this section no longer uses the shared `Section` wrapper, for the same reason (needs a full-bleed absolutely-positioned background, which `Section`'s `atelier-container`-constrained inner div can't provide) — it reconstructs the same `scroll-mt-16 border-t border-border py-20 sm:py-24` treatment (the `py-20 sm:py-24` now lives on the inner `atelier-container` div instead, matching every other section's rhythm).

- [ ] **Step 2: Verify the image exists**

`ls public/landing/final-cta-bg.jpg` — must exist from Task 1.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` — expected PASS.

- [ ] **Step 4: Manual check**

`bun run dev`, open `/`, scroll to the final section. Confirm: the photo is visible but subdued behind the text (scrim keeps the heading/body/button fully legible), the photo spans full browser width, and it very subtly scales down from slightly-zoomed to normal as it scrolls into view. With `prefers-reduced-motion: reduce` enabled, confirm the photo shows at its final scale immediately, no animation.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/final-cta-section.tsx
git commit -m "feat: replace Final CTA's decorative blur blob with a full-bleed editorial photo"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck, lint, unit tests, build**

Run in order: `nvm use 22 && bun run typecheck && bun run lint && bun test && bun run build` — all must PASS.

- [ ] **Step 2: Accessibility scan**

Run: `nvm use 22 && bun run test:e2e -- accessibility.spec.ts` — expected PASS, 7/7. This specifically catches any new `<img>` missing `alt` text (every new image above has one, except the two intentionally-decorative `aria-hidden="true"` background images in Final CTA, which axe correctly ignores).

- [ ] **Step 3: Full visual pass, all 6 breakpoints from web/testing.md convention**

Using the same throwaway-Playwright-screenshot method as the original audit, capture `/` at 320, 768, 1024, and 1440px, full-page. Confirm for each:
- All 10 new images render (no broken-image icons).
- Feed's photo grid and Final CTA's background photo are genuinely full-bleed (extend to the viewport edges) at every width.
- No layout overflow or horizontal scrollbar introduced at any breakpoint.
- Section rhythm reads as varied, not uniform (Feed and Final CTA visually distinct from the container-width sections around them).

- [ ] **Step 4: Reduced-motion pass**

With browser devtools' `prefers-reduced-motion: reduce` emulation on, reload `/` and confirm: hero photo appears immediately at full opacity/scale, How It Works steps appear together (no stagger), Feed tiles appear together (no stagger), Final CTA background photo shows at final scale immediately (no drift).

- [ ] **Step 5: Nothing to commit**

Verification-only; any fix needed should have been amended into its own earlier task's commit, not batched here.

---

### Task 13: Push and deploy

**This task requires explicit confirmation before running** — it pushes to `origin/main` and triggers a production deployment.

- [ ] **Step 1:** `git push origin main`
- [ ] **Step 2:** Confirm the Vercel git-integration deployment reaches `READY` (poll `list_deployments`/`get_deployment` for the project).
- [ ] **Step 3:** Repeat Task 12 Step 3's visual pass against the production URL.

---

## Self-Review Notes

- **Spec coverage:** every section listed in the spec's "Section-by-section design" has a task, except Pricing (explicitly dropped — see "Deviations from spec" above) and Community/Testimonials (spec itself calls for zero changes there).
- **No placeholders:** every step has complete, exact code.
- **Type consistency:** `Reveal`'s new `stagger`/`RevealItem` (Task 2) are consumed identically by `Section` (Task 3), `HowItWorksSection` (Task 5), and `FeedSection` (Task 10) — same prop names, same shapes throughout.
- **Ordering:** Task 1 (image generation) is first and every later task that references a generated image includes an explicit "verify the file exists" step before editing code that points at it, so a partial/failed image generation run surfaces immediately rather than shipping a broken `<img>` silently.
