# Nav Routing + Landing Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every landing-page nav item a real, linkable route, and fix the two documented `docs/DESIGN.md` violations found on the landing/legal surface (eyebrow-kicker-on-every-section, decorative rose blob on legal pages).

**Architecture:** Five new top-level routes (`/how-it-works`, `/style-dossier`, `/dupe-hunter`, `/community`, `/membership`) each render the *same* existing landing section component the homepage already uses, wrapped in one new shared `MarketingSubpage` layout (header, back link, section, closing CTA, footer). `SiteHeader` stops taking a `sections` prop and instead points at a static nav list. `SectionHeading` stops rendering its per-section eyebrow line.

**Tech Stack:** TanStack Start / React Router (file-based routing, auto-generates `src/routeTree.gen.ts` on `vite dev`/`vite build`), Tailwind v4, bun test, Playwright + axe-core.

**Deviation from spec:** `docs/superpowers/specs/2026-09-28-nav-routing-landing-design.md` mentioned homepage sections getting a "Full story →" link to their new dedicated page. Dropped here: since each dedicated page renders the *identical* section component (same content, no expanded copy), a homepage link to "more" content that is actually the same content would be redundant and confusing. The header nav alone fully satisfies the goal (every nav item → a real page).

---

### Task 1: Static nav list

**Files:**
- Create: `src/constants/nav.ts`

- [ ] **Step 1: Create the file**

```ts
export const MAIN_NAV_LINKS = [
  { to: "/how-it-works", label: "How it Works" },
  { to: "/style-dossier", label: "Style Dossier" },
  { to: "/dupe-hunter", label: "Dupe Hunter" },
  { to: "/community", label: "Community" },
  { to: "/membership", label: "Membership" },
] as const;
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no new errors (file isn't imported anywhere yet).

- [ ] **Step 3: Commit**

```bash
git add src/constants/nav.ts
git commit -m "feat: add static main-nav link list"
```

---

### Task 2: Remove the per-section eyebrow from `SectionHeading`

**Files:**
- Modify: `src/components/landing/section.tsx:67-94`

- [ ] **Step 1: Replace `SectionHeading`**

Replace the existing `SectionHeading` function (lines 67-94) with:

```tsx
export function SectionHeading({
  heading,
  body,
  align = "left",
  className,
}: {
  heading: string;
  body?: string;
  align?: "left" | "center";
  className?: string;
}) {
  const centered = align === "center";
  return (
    <div className={cn("max-w-xl", centered && "mx-auto text-center", className)}>
      <h2 className="text-[clamp(2rem,4vw,3rem)] leading-[1.05]">{heading}</h2>
      {body ? (
        <p className="mt-6 text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
          {body}
        </p>
      ) : null}
    </div>
  );
}
```

Leave `Eyebrow` and everything else in the file untouched — `Eyebrow` is still used standalone for per-value labels inside `dossier-section.tsx` and `dupe-hunter-section.tsx` (labeling one card/row, not prefacing a whole section — a different, non-banned use per `docs/DESIGN.md`'s No-Eyebrow Rule).

- [ ] **Step 2: Typecheck (expect failures — this is intentional)**

Run: `bun run typecheck`
Expected: FAIL — 8 call sites still pass a `kicker` prop that no longer exists on `SectionHeading`. This confirms the type change took effect; Task 3 fixes every call site.

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/section.tsx
git commit -m "fix: remove eyebrow-kicker line from SectionHeading (docs/DESIGN.md No-Eyebrow Rule)"
```

---

### Task 3: Fix every `SectionHeading` call site

**Files:**
- Modify: `src/components/landing/how-it-works-section.tsx:10`
- Modify: `src/components/landing/dossier-section.tsx:9-19`
- Modify: `src/components/landing/dupe-hunter-section.tsx:33-40`
- Modify: `src/components/landing/community-section.tsx:14-19`
- Modify: `src/components/landing/pricing-section.tsx:16-21`
- Modify: `src/components/landing/daily-palette-section.tsx:13-17`
- Modify: `src/components/landing/concierge-section.tsx:18-22`
- Modify: `src/components/landing/feed-section.tsx:7-11`

- [ ] **Step 1: `how-it-works-section.tsx`**

Change line 10 from:
```tsx
      <SectionHeading align="center" kicker={content.kicker} heading={content.heading} />
```
to:
```tsx
      <SectionHeading align="center" heading={content.heading} />
```

- [ ] **Step 2: `dossier-section.tsx`**

Change line 10 from:
```tsx
        <SectionHeading kicker={content.kicker} heading={content.heading} body={content.body} />
```
to:
```tsx
        <SectionHeading heading={content.heading} body={content.body} />
```

- [ ] **Step 3: `dupe-hunter-section.tsx`**

Change line 39 from:
```tsx
        <SectionHeading kicker={content.kicker} heading={content.heading} body={content.body} />
```
to:
```tsx
        <SectionHeading heading={content.heading} body={content.body} />
```

- [ ] **Step 4: `community-section.tsx`**

Change lines 14-19 from:
```tsx
      <SectionHeading
        align="center"
        kicker={content.kicker}
        heading={content.heading}
        body={content.body}
      />
```
to:
```tsx
      <SectionHeading align="center" heading={content.heading} body={content.body} />
```

- [ ] **Step 5: `pricing-section.tsx`**

Change lines 16-21 from:
```tsx
      <SectionHeading
        align="center"
        kicker="Membership"
        heading="Choose your Atelier access."
        body="Every plan includes daily styling credits, credit packs to top up any day, and a verified badge on your profile."
      />
```
to:
```tsx
      <SectionHeading
        align="center"
        heading="Choose your Atelier access."
        body="Every plan includes daily styling credits, credit packs to top up any day, and a verified badge on your profile."
      />
```

- [ ] **Step 6: `daily-palette-section.tsx`**

Change lines 13-17 from:
```tsx
        <SectionHeading
          kicker="Daily Palette"
          heading="A new color mix, every morning."
          body="Three colors pulled fresh from your season each day — base, statement, and accent — so you never second-guess what goes together."
        />
```
to:
```tsx
        <SectionHeading
          heading="A new color mix, every morning."
          body="Three colors pulled fresh from your season each day — base, statement, and accent — so you never second-guess what goes together."
        />
```

- [ ] **Step 7: `concierge-section.tsx`**

Change lines 18-22 from:
```tsx
        <SectionHeading
          kicker="AI Styling Concierge"
          heading="Ask Mila anything, anytime."
          body="Not sure about a pairing? Stuck between two looks? Mila remembers your dossier and every look you've saved — just ask."
        />
```
to:
```tsx
        <SectionHeading
          heading="Ask Mila anything, anytime."
          body="Not sure about a pairing? Stuck between two looks? Mila remembers your dossier and every look you've saved — just ask."
        />
```

- [ ] **Step 8: `feed-section.tsx`**

Change lines 7-11 from:
```tsx
      <SectionHeading
        align="center"
        kicker="The Atelier Feed"
        heading="Post today's fit. See everyone else's."
        body="One photo, tagged automatically — every piece becomes shoppable for the whole community."
      />
```
to:
```tsx
      <SectionHeading
        align="center"
        heading="Post today's fit. See everyone else's."
        body="One photo, tagged automatically — every piece becomes shoppable for the whole community."
      />
```

- [ ] **Step 9: Typecheck — must pass now**

Run: `bun run typecheck`
Expected: PASS, no errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/landing/how-it-works-section.tsx \
        src/components/landing/dossier-section.tsx \
        src/components/landing/dupe-hunter-section.tsx \
        src/components/landing/community-section.tsx \
        src/components/landing/pricing-section.tsx \
        src/components/landing/daily-palette-section.tsx \
        src/components/landing/concierge-section.tsx \
        src/components/landing/feed-section.tsx
git commit -m "fix: drop removed kicker prop from all SectionHeading call sites"
```

---

### Task 4: Fix `legal-page.tsx` (deprecated kicker + decorative rose blob)

**Files:**
- Modify: `src/components/legal/legal-page.tsx` (full rewrite, it's 51 lines)
- Modify: `src/routes/privacy.tsx:13`
- Modify: `src/routes/terms.tsx:13`

- [ ] **Step 1: Rewrite `legal-page.tsx`**

```tsx
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="relative atelier-page max-w-3xl">
        <div className="mb-10 flex flex-col items-center text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2.5 font-serif text-2xl tracking-label-xwide"
          >
            <img src="/favicon.svg" alt="" className="size-7" />
            MILA
          </Link>
          <h1 className="atelier-title mt-4">{title}</h1>
        </div>

        <article className="atelier-card mx-auto max-w-2xl space-y-5 p-6 text-sm leading-relaxed text-foreground sm:p-10">
          {children}
        </article>

        <div className="mt-8 text-center">
          <Link
            to="/"
            className="atelier-focus-ring inline-flex items-center gap-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
```

This removes: the `kicker` prop (no longer rendered anywhere), the two decorative blur blobs (champagne and — the doc-reserved — rose), and the now-pointless `overflow-hidden` on the outer wrapper.

- [ ] **Step 2: `privacy.tsx`**

Change line 13 from:
```tsx
    <LegalPage kicker="Legal" title="Privacy Policy">
```
to:
```tsx
    <LegalPage title="Privacy Policy">
```

- [ ] **Step 3: `terms.tsx`**

Change line 13 from:
```tsx
    <LegalPage kicker="Legal" title="Terms of Service">
```
to:
```tsx
    <LegalPage title="Terms of Service">
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual check**

Run: `bun run dev`, open `https://localhost:8080/privacy` and `/terms`. Confirm: no eyebrow line above the "Privacy Policy"/"Terms of Service" heading, no glowing color blobs, logo links back to `/`.

- [ ] **Step 6: Commit**

```bash
git add src/components/legal/legal-page.tsx src/routes/privacy.tsx src/routes/terms.tsx
git commit -m "fix: remove deprecated kicker and decorative rose blob from legal pages"
```

---

### Task 5: Rewrite `SiteHeader` — real nav links, no more anchors

**Files:**
- Modify: `src/components/landing/site-header.tsx` (full rewrite, it's 101 lines)

- [ ] **Step 1: Rewrite the file**

```tsx
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { MAIN_NAV_LINKS } from "@/constants/nav";

export function SiteHeader() {
  const { session } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const destination = session ? "/dashboard" : "/login";
  const label = session ? "Dashboard" : "Sign in";

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-canvas/80 backdrop-blur-md">
      <div className="atelier-container flex h-16 items-center justify-between gap-6">
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-control font-serif text-xl font-bold tracking-label-xwide text-foreground"
        >
          <img src="/favicon.svg" alt="" width={24} height={24} className="size-6" />
          MILA
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {MAIN_NAV_LINKS.map((link) => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  className="inline-flex h-9 items-center rounded-pill px-3.5 text-sm text-muted-foreground transition-colors duration-200 ease-editorial hover:bg-accent-soft/50 hover:text-ink"
                  activeProps={{ className: "bg-accent-soft/60 text-ink" }}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <Button
            asChild
            variant="outline"
            size="pill"
            className="text-label uppercase tracking-label"
          >
            <Link to={destination}>{label}</Link>
          </Button>
          <IconButton
            label="Open menu"
            variant="outline"
            size="sm"
            className="lg:hidden"
            onClick={() => setNavOpen(true)}
          >
            <Menu />
          </IconButton>
        </div>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-6 sm:max-w-xs">
          <SheetHeader>
            <SheetTitle className="font-serif text-xl">Explore MILA</SheetTitle>
          </SheetHeader>
          <nav aria-label="Main">
            <ul className="flex flex-col gap-1">
              {MAIN_NAV_LINKS.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    onClick={() => setNavOpen(false)}
                    className="flex h-11 items-center rounded-control px-3 text-sm text-muted-foreground transition-colors duration-200 ease-editorial hover:bg-accent-soft/50 hover:text-ink"
                    activeProps={{ className: "bg-accent-soft/60 text-ink" }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Button asChild variant="primary" size="md" className="mt-auto w-full">
            <Link to={destination} onClick={() => setNavOpen(false)}>
              {label}
            </Link>
          </Button>
        </SheetContent>
      </Sheet>
    </header>
  );
}
```

Note: `NavSection` type and the `sections` prop are gone entirely — nav is now the same on every page, sourced from `MAIN_NAV_LINKS`.

- [ ] **Step 2: Typecheck (expect a failure in `index.tsx` — fixed next task)**

Run: `bun run typecheck`
Expected: FAIL — `src/routes/index.tsx` still imports `NavSection` and passes a `sections` prop that no longer exists.

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/site-header.tsx
git commit -m "fix: SiteHeader nav links point to real routes instead of #anchor scrolling"
```

---

### Task 6: Update `index.tsx` for the new `SiteHeader`

**Files:**
- Modify: `src/routes/index.tsx:50-60`

- [ ] **Step 1: Remove the local `sections` array and the prop**

Delete lines 50-56:
```tsx
  const sections = [
    { id: "how-it-works", label: content.howItWorks.kicker },
    { id: "dossier", label: content.dossier.kicker },
    { id: "dupe-hunter", label: content.dupeHunter.kicker },
    { id: "community", label: content.community.kicker },
    { id: "pricing", label: "Pricing" },
  ];

```

Change line 60 from:
```tsx
      <SiteHeader sections={sections} />
```
to:
```tsx
      <SiteHeader />
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/index.tsx
git commit -m "fix: drop obsolete sections prop from homepage SiteHeader usage"
```

---

### Task 7: Shared `MarketingSubpage` layout

**Files:**
- Create: `src/components/landing/marketing-subpage.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { CtaButton } from "@/components/landing/cta-button";
import type { FooterContent } from "@/lib/landing-content";

export function MarketingSubpage({
  footer,
  children,
}: {
  footer: FooterContent;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="overflow-x-clip">
        <div className="atelier-container pt-8">
          <Link
            to="/"
            className="atelier-focus-ring inline-flex items-center gap-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to home
          </Link>
        </div>

        {children}

        <div className="atelier-container border-t border-border py-20 text-center sm:py-24">
          <h2 className="text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
            Ready for your first look?
          </h2>
          <div className="mt-8 flex justify-center">
            <CtaButton />
          </div>
        </div>
      </main>
      <SiteFooter content={footer} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (unused new file, no import errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/marketing-subpage.tsx
git commit -m "feat: add MarketingSubpage shared layout for dedicated nav-destination pages"
```

---

### Task 8: Five new routes

**Files:**
- Create: `src/routes/how-it-works.tsx`
- Create: `src/routes/style-dossier.tsx`
- Create: `src/routes/dupe-hunter.tsx`
- Create: `src/routes/community.tsx`
- Create: `src/routes/membership.tsx`

- [ ] **Step 1: `src/routes/how-it-works.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { getLandingContent } from "@/lib/landing-content.functions";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({ meta: [{ title: "How it Works — Mila" }] }),
  loader: () => getLandingContent(),
  staleTime: 5 * 60 * 1000,
  component: HowItWorksPage,
});

function HowItWorksPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage footer={content.footer}>
      <HowItWorksSection content={content.howItWorks} />
    </MarketingSubpage>
  );
}
```

- [ ] **Step 2: `src/routes/style-dossier.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { getLandingContent } from "@/lib/landing-content.functions";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { DossierSection } from "@/components/landing/dossier-section";

export const Route = createFileRoute("/style-dossier")({
  head: () => ({ meta: [{ title: "The Style Dossier — Mila" }] }),
  loader: () => getLandingContent(),
  staleTime: 5 * 60 * 1000,
  component: StyleDossierPage,
});

function StyleDossierPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage footer={content.footer}>
      <DossierSection content={content.dossier} />
    </MarketingSubpage>
  );
}
```

- [ ] **Step 3: `src/routes/dupe-hunter.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { getLandingContent } from "@/lib/landing-content.functions";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { DupeHunterSection } from "@/components/landing/dupe-hunter-section";

export const Route = createFileRoute("/dupe-hunter")({
  head: () => ({ meta: [{ title: "Dupe Hunter — Mila" }] }),
  loader: () => getLandingContent(),
  staleTime: 5 * 60 * 1000,
  component: DupeHunterPage,
});

function DupeHunterPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage footer={content.footer}>
      <DupeHunterSection content={content.dupeHunter} />
    </MarketingSubpage>
  );
}
```

- [ ] **Step 4: `src/routes/community.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { getLandingContent } from "@/lib/landing-content.functions";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { CommunitySection } from "@/components/landing/community-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";

export const Route = createFileRoute("/community")({
  head: () => ({ meta: [{ title: "Community — Mila" }] }),
  loader: () => getLandingContent(),
  staleTime: 5 * 60 * 1000,
  component: CommunityPage,
});

function CommunityPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage footer={content.footer}>
      <CommunitySection content={content.community}>
        <TestimonialsSection testimonials={content.testimonials} />
      </CommunitySection>
    </MarketingSubpage>
  );
}
```

- [ ] **Step 5: `src/routes/membership.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { getLandingContent } from "@/lib/landing-content.functions";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { PricingSection } from "@/components/landing/pricing-section";

export const Route = createFileRoute("/membership")({
  head: () => ({ meta: [{ title: "Membership — Mila" }] }),
  loader: () => getLandingContent(),
  staleTime: 5 * 60 * 1000,
  component: MembershipPage,
});

function MembershipPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage footer={content.footer}>
      <PricingSection />
    </MarketingSubpage>
  );
}
```

- [ ] **Step 6: Regenerate the route tree and build**

Run: `bun run build`
Expected: PASS. This regenerates `src/routeTree.gen.ts` with the five new `fullPath` entries and confirms the whole app (including the Vercel/Nitro build) still compiles with the new routes wired in.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/routes/how-it-works.tsx src/routes/style-dossier.tsx \
        src/routes/dupe-hunter.tsx src/routes/community.tsx \
        src/routes/membership.tsx src/routeTree.gen.ts
git commit -m "feat: add dedicated /how-it-works, /style-dossier, /dupe-hunter, /community, /membership routes"
```

---

### Task 9: Route-tree regression test

**Files:**
- Modify: `src/routeTree.test.ts`

- [ ] **Step 1: Write the test**

Add to the existing file (after the current `test(...)` block):

```ts
test("the generated route tree includes all five nav-destination routes", () => {
  expect(routeTree).toMatch(/fullPath: '\/how-it-works'/);
  expect(routeTree).toMatch(/fullPath: '\/style-dossier'/);
  expect(routeTree).toMatch(/fullPath: '\/dupe-hunter'/);
  expect(routeTree).toMatch(/fullPath: '\/community'/);
  expect(routeTree).toMatch(/fullPath: '\/membership'/);
});
```

- [ ] **Step 2: Run it**

Run: `bun test src/routeTree.test.ts`
Expected: PASS (Task 8's `bun run build` already regenerated `routeTree.gen.ts` with these entries).

- [ ] **Step 3: Commit**

```bash
git add src/routeTree.test.ts
git commit -m "test: assert all five nav-destination routes exist in the generated route tree"
```

---

### Task 10: Playwright — accessibility scan for the new routes

**Files:**
- Modify: `tests/e2e/accessibility.spec.ts`

- [ ] **Step 1: Update the file's scope comment and add five tests**

Replace the file's doc comment (lines 4-11) to add the new routes to scope, and append one `test(...)` per new route, following the exact existing pattern:

```ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Runtime accessibility scan for MILA's unauthenticated public routes.
 *
 * Scope is intentionally limited to these routes and `/login`: every other
 * route sits behind Supabase session auth (see src/routes/_authenticated),
 * which would require a full login flow (and hCaptcha) to reach.
 * Authenticated routes are covered by manual a11y review instead (see Item 7
 * of the a11y punch list).
 */

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/how-it-works",
  "/style-dossier",
  "/dupe-hunter",
  "/community",
  "/membership",
];

test.describe("accessibility", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} has no automatically detectable a11y violations`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator("body")).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      expect(results.violations).toEqual([]);
    });
  }
});
```

This replaces the two hand-written tests with a loop covering the original two routes plus the five new ones — same assertions, no behavior change for `/` and `/login`.

- [ ] **Step 2: Run it**

Run: `bun run test:e2e -- accessibility.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/accessibility.spec.ts
git commit -m "test: extend a11y scan to the five new nav-destination routes"
```

---

### Task 11: Playwright — nav actually navigates

**Files:**
- Create: `tests/e2e/nav-links.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from "@playwright/test";

const NAV_DESTINATIONS: Array<{ label: string; path: string }> = [
  { label: "How it Works", path: "/how-it-works" },
  { label: "Style Dossier", path: "/style-dossier" },
  { label: "Dupe Hunter", path: "/dupe-hunter" },
  { label: "Community", path: "/community" },
  { label: "Membership", path: "/membership" },
];

test.describe("main nav", () => {
  for (const { label, path } of NAV_DESTINATIONS) {
    test(`"${label}" nav link navigates to ${path}`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator("h1, h2").first()).toBeVisible();
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `bun run test:e2e -- nav-links.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/nav-links.spec.ts
git commit -m "test: verify every main-nav link lands on its own real page"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: PASS. Fix any `jsx-a11y` or unused-import findings surfaced by the removed `kicker`/`sections` props before proceeding.

- [ ] **Step 3: Unit tests**

Run: `bun test`
Expected: PASS, including the new `routeTree.test.ts` assertion.

- [ ] **Step 4: Full e2e suite**

Run: `bun run test:e2e`
Expected: PASS, all accessibility and nav-link tests green.

- [ ] **Step 5: Production build**

Run: `bun run build`
Expected: PASS, clean build output.

- [ ] **Step 6: Manual pass**

Run: `bun run dev`, then in a browser:
- From `/`, click every header nav item (desktop and, at a narrow viewport, the mobile sheet menu) and confirm each lands on its own URL with visible content.
- Confirm no section on `/` shows an uppercase eyebrow line above its heading (except the hero's bordered pill badge, which is unchanged).
- Confirm `/privacy` and `/terms` show no color blobs and no eyebrow line.

- [ ] **Step 7: Nothing to commit**

This task is verification-only; if any step above required a fix, that fix should already be committed as part of amending the relevant earlier task, not batched here.

---

### Task 13: Push and deploy

**This task requires explicit confirmation before running** — it pushes to `origin/main` and triggers a production deployment, both shared/hard-to-reverse actions.

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Deploy**

Use the Vercel MCP `deploy_to_vercel` tool (or `vercel --prod` if working from the CLI) targeting the MILA project, then confirm the deployment succeeds via `list_deployments` / `get_deployment` before considering this done.

- [ ] **Step 3: Post-deploy smoke check**

Repeat Task 12 Step 6's manual pass against the production URL instead of localhost.

---

## Self-Review Notes

- **Spec coverage:** every requirement in `docs/superpowers/specs/2026-09-28-nav-routing-landing-design.md` maps to a task above, except the "Full story →" homepage links, which are deliberately dropped (see "Deviation from spec" at the top) since the dedicated pages reuse identical section content rather than expanded copy.
- **No placeholders:** every step has complete, exact code — nothing marked TBD.
- **Type consistency:** `MAIN_NAV_LINKS` (Task 1) → consumed by `SiteHeader` (Task 5) with matching `{ to, label }` shape. `SectionHeading`'s new `{ heading, body, align, className }` signature (Task 2) matches every call site fixed in Task 3. `MarketingSubpage`'s `{ footer, children }` props (Task 7) match every route file's usage in Task 8.
