/**
 * Landing-page editorial content, as published from the MILA Sanity Studio
 * (`landingPage` singleton). Everything here is copy, imagery or visibility —
 * never routes, prices charged, plan identity or entitlements. Those stay in
 * code (CTA destinations) and Supabase/Paddle (plans), so an editor can't
 * point a button somewhere unsafe or change what a member pays.
 *
 * The shape is validated by `normalizeLandingContent` and backed by the
 * checked-in `LANDING_FALLBACK`; components can rely on every field existing.
 */

/** An image the page renders: a Sanity CDN URL or a static `/public` path. */
export type LandingImage = { src: string; alt: string };

export type Testimonial = { _key: string; name: string; season: string; quote: string };
export type Step = { _key: string; number: string; title: string; body: string };
export type DossierRow = { _key: string; label: string; value: string };
export type DupeCard = { label: string; title: string; price: string; image: LandingImage };
export type PaletteSwatch = { _key: string; label: string; hex: string };
export type ConciergeMessage = { _key: string; role: "user" | "assistant"; text: string };
export type FeedImage = LandingImage & { _key: string };

export type SeoContent = { title: string; description: string; socialDescription: string };

/** Labels for the shared CTA button. Destinations are code-owned. */
export type CtaContent = { signedOutLabel: string; signedInLabel: string };

export type HeroContent = {
  kicker: string;
  headlineLine1: string;
  headlineLine2: string;
  subhead: string;
  ctaNote: string;
  preview: {
    season: string;
    weather: string;
    outfitTitle: string;
    outfitBody: string;
    hair: string;
    makeup: string;
  };
  image: LandingImage;
  imageCaption: string;
};

export type HowItWorksContent = {
  hidden: boolean;
  kicker: string;
  heading: string;
  steps: Step[];
};

export type DossierContent = {
  hidden: boolean;
  kicker: string;
  heading: string;
  body: string;
  cardTitle: string;
  season: string;
  rows: DossierRow[];
  completionLabel: string;
  completionPercent: number;
  image: LandingImage;
};

export type DailyPaletteContent = {
  hidden: boolean;
  heading: string;
  body: string;
  image: LandingImage;
  swatches: PaletteSwatch[];
};

export type ConciergeContent = {
  hidden: boolean;
  heading: string;
  body: string;
  image: LandingImage;
  exchange: ConciergeMessage[];
};

export type DupeHunterContent = {
  hidden: boolean;
  kicker: string;
  heading: string;
  body: string;
  inspiration: DupeCard;
  milaMatch: DupeCard;
};

export type FeedContent = {
  hidden: boolean;
  heading: string;
  body: string;
  images: FeedImage[];
};

export type CommunityContent = {
  hidden: boolean;
  hideTestimonials: boolean;
  kicker: string;
  heading: string;
  body: string;
  seasonChips: string[];
};

/** Editorial framing only — plan names, prices and actions come from Supabase. */
export type PricingContent = { hidden: boolean; heading: string; body: string };

export type FinalCtaContent = {
  hidden: boolean;
  heading: string;
  body: string;
  privacyNote: string;
  backgroundImage: LandingImage;
};

export type SubpageCtaContent = { heading: string };
export type FooterContent = { wordmark: string; tagline: string };

export type LandingContent = {
  seo: SeoContent;
  cta: CtaContent;
  hero: HeroContent;
  testimonials: Testimonial[];
  howItWorks: HowItWorksContent;
  dossier: DossierContent;
  dailyPalette: DailyPaletteContent;
  concierge: ConciergeContent;
  dupeHunter: DupeHunterContent;
  feed: FeedContent;
  community: CommunityContent;
  pricing: PricingContent;
  finalCta: FinalCtaContent;
  subpageCta: SubpageCtaContent;
  footer: FooterContent;
};
