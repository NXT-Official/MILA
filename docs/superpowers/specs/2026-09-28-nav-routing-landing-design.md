# Nav Routing + Landing Page Compliance — Design

**Date:** 2026-09-28
**Status:** Approved for planning
**Scope:** Sub-project 1 of 3 (landing/nav). Rest-of-app design audit is a separate, later sub-project.

## Problem

1. `SiteHeader`'s nav ("How it Works", "Dossier", "Dupe Hunter", "Community", "Pricing") are `#anchor` scroll links into the single `/` page. There is no real destination — every nav item is the same page.
2. The codebase has a written, opinionated anti-slop design system (`docs/DESIGN.md`, "Atelier Dossier") that explicitly bans several patterns. The current landing implementation violates its own spec in two places:
   - **The No-Eyebrow Rule**: "The tiny uppercase tracked kicker above every section is prohibited... a kicker on every section is scaffolding." `SectionHeading` (`src/components/landing/section.tsx`) renders exactly this — an `Eyebrow` line above 8 of the landing page's ~10 sections.
   - `legal-page.tsx` uses the doc-deprecated `.atelier-kicker` class and two decorative blur blobs, one in Powder Rose — a color the doc reserves ("never a general-purpose accent").

Everything else audited (color tokens, type scale, radii, shadow vocabulary, `Reveal` motion + reduced-motion handling, button/card primitives) already complies with `docs/DESIGN.md`. This is a targeted fix, not a redesign.

## Goals

- Every nav item resolves to a real, linkable, bookmarkable route.
- Landing page and its new subpages stop violating the project's own written design spec.
- No new visual language invented — apply the existing `docs/DESIGN.md` system correctly.

## Non-goals (explicitly out of scope for this pass)

- Authenticated app screens (dashboard, style-profile, onboarding, concierge, feed, account) — separate sub-project.
- The 7 other `.atelier-kicker` usages outside the landing/legal surface (login, forgot-password, reset-password, onboarding, dashboard, style-profile) — flagged, not touched here.
- New CMS content fields (e.g. a pricing FAQ) beyond what `getLandingContent()` already returns.
- Changing color tokens, type scale, radii, or shadow vocabulary — already compliant.

## Architecture

### 1. New public routes

Five new top-level route files, each a real page (not a scroll anchor):

| Nav label | Route | Notes |
|---|---|---|
| How it Works | `/how-it-works` | |
| Style Dossier | `/style-dossier` | |
| Dupe Hunter | `/dupe-hunter` | |
| Community | `/community` | |
| Membership | `/membership` | **Not** `/pricing` — that path already belongs to the authenticated app's in-app pricing page (`src/routes/_authenticated/_app/pricing.tsx`) and redirects logged-out visitors to `/login`. |

Each route:
- Calls the same `getLandingContent()` loader the homepage already uses (CMS-backed via Sanity), so subpage copy never drifts from the homepage's copy — one source of truth.
- Renders through one new shared layout component (below), giving the relevant section full-page room instead of the homepage's condensed half-grid treatment.
- Ends with the same `CtaButton` + `SiteFooter` used elsewhere.

### 2. New shared component: `MarketingSubpage`

`src/components/landing/marketing-subpage.tsx` — the layout every new route wraps in:

```
<div className="min-h-screen">
  <SiteHeader />
  <main>
    <back-link to="/">
    <h1> (page heading, no eyebrow line — see compliance fix below)
    {children}  — the expanded section content
    <closing CTA block>
  </main>
  <SiteFooter content={...} />
</div>
```

This mirrors `LegalPage`'s role (a reusable shell for standalone pages) but stays in the `landing/` folder since it shares `SiteHeader`/`SiteFooter`/`CtaButton`, not the legal folder's minimal chrome.

### 3. Header fix — `site-header.tsx`

- Nav becomes a static, page-independent list — it no longer needs a `sections` prop passed in from each page (today only `index.tsx` passes it; the new pages would otherwise all have to repeat the same array). Add `src/constants/nav.ts`:
  ```ts
  export const MAIN_NAV_LINKS = [
    { to: "/how-it-works", label: "How it Works" },
    { to: "/style-dossier", label: "Style Dossier" },
    { to: "/dupe-hunter", label: "Dupe Hunter" },
    { to: "/community", label: "Community" },
    { to: "/membership", label: "Membership" },
  ] as const;
  ```
  Labels are static English strings, intentionally decoupled from the CMS `kicker` fields (nav wording shouldn't shift because an editor changed a homepage section's kicker copy).
- `SiteHeader` drops the `NavSection`/`sections` prop entirely; it imports `MAIN_NAV_LINKS` directly. Desktop and mobile-sheet nav both render `<Link to={link.to}>` with `activeProps` (TanStack Router) for the current-page state instead of a plain anchor + no active state.
- Logo: `<a href="#top">` → `<Link to="/">`.
- `index.tsx` drops its local `sections` array and the `sections` prop on `<SiteHeader />`.

### 4. Homepage stays a condensed scroll page

Each condensed homepage section (`HowItWorksSection`, `DossierSection`, `DupeHunterSection`, `CommunitySection`, `PricingSection`) gets one small addition: a "Full story →" (or section-appropriate label) `Link` to its matching new route, placed near the section heading. `HeroSection` and `FinalCtaSection` get no dedicated page — they stay homepage-only.

### 5. Design-system compliance fixes

- **`SectionHeading`** (`section.tsx`): remove the `kicker` prop and the `Eyebrow` line it renders, entirely. Every call site (`HowItWorksSection`, `DossierSection`, `DupeHunterSection`, `CommunitySection`, `PricingSection`, `DailyPaletteSection`, `ConciergeSection`, `FeedSection`, and the new `MarketingSubpage` page headings) stops passing `kicker` and relies on the heading + body copy alone, which is already descriptive enough on its own. `Eyebrow` the sub-component stays exported (still used standalone inside `dossier-section.tsx`'s completion row and `dupe-hunter-section.tsx`'s column labels, which are labeling a specific value, not prefacing a whole section — a different, non-banned use). Exception: the hero's pill badge (icon + kicker text inside a bordered pill chip) stays — it's a bounded badge component, not a bare eyebrow line, and is the one deliberate brand device the doc permits ("one named kicker used deliberately as a brand device is voice").
- **`legal-page.tsx`**: remove the `.atelier-kicker` paragraph and both decorative blur blobs (champagne and rose). Keep logo + `h1` title only — a legal document doesn't need atmosphere, and Powder Rose isn't an approved decorative accent.

## Data flow

No new data sources. All five new routes and the homepage share one loader (`getLandingContent()`), already cached via the route's existing `staleTime: 5 * 60 * 1000`. `/membership` additionally reuses the existing `publicSubscriptionPlansQueryOptions()` query that `PricingSection` already calls — same query, just full-page layout instead of a homepage grid.

## Error handling

- If `getLandingContent()` fails or returns partial data for a section a new route depends on, that route renders the existing loading/error state pattern already used elsewhere (`ErrorState` / `EmptyState` from `src/components/ui`) rather than a blank page.
- `/membership`: reuse `PricingSection`'s existing empty-state behavior (renders nothing if the plans query errors or returns zero plans) — no new error UI to design.

## Testing

- Extend `tests/e2e/accessibility.spec.ts` with one axe scan per new public route (`/how-it-works`, `/style-dossier`, `/dupe-hunter`, `/community`, `/membership`), matching the existing `/` and `/login` pattern.
- New Playwright test: from `/`, click each header nav link, assert the URL changes to the expected route and the page renders its `h1` — closes out the original bug report ("every nav button does have another page").
- No unit tests needed for the `Eyebrow` removal (a pure JSX/markup change); covered by the accessibility scan (removing a redundant, already-passing-contrast element shouldn't introduce violations, and removes one more DOM node axe has to check).

## Rollout

Single PR. No feature flag needed — nav routing and eyebrow removal are both strictly corrective (fixing a broken affordance and a documented spec violation), not a soft-launch feature.

## Follow-up (not this pass)

- `.atelier-kicker` cleanup in `login/index.tsx`, `login/forgot-password.tsx`, `auth/reset-password.tsx`, `dashboard.tsx` (`look-section.tsx`), `style-profile-page.tsx`, `known-season-picker.tsx`, `DailyPaletteGenerator.tsx`.
- Decorative blur-blob audit in `camera-capture.tsx`, `membership-view.tsx`, `dashboard.tsx`, `login/index.tsx`, `login/forgot-password.tsx`, `auth/reset-password.tsx`.
- These belong to the "rest of app" sub-project agreed during scoping.
