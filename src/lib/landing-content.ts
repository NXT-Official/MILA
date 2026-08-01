export type Testimonial = { _key: string; name: string; season: string; quote: string };
export type Step = { _key: string; number: string; title: string; body: string };
export type DossierRow = { _key: string; label: string; value: string };
export type DupeCard = { label: string; title: string; price: string };

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
};

export type HowItWorksContent = { kicker: string; heading: string; steps: Step[] };

export type DossierContent = {
  kicker: string;
  heading: string;
  body: string;
  cardTitle: string;
  season: string;
  rows: DossierRow[];
  completionLabel: string;
  completionPercent: number;
};

export type DupeHunterContent = {
  kicker: string;
  heading: string;
  body: string;
  inspiration: DupeCard;
  milaMatch: DupeCard;
};

export type CommunityContent = {
  kicker: string;
  heading: string;
  body: string;
  seasonChips: string[];
};

export type FinalCtaContent = { heading: string; body: string; privacyNote: string };
export type FooterContent = { wordmark: string; tagline: string };

export type LandingContent = {
  hero: HeroContent;
  testimonials: Testimonial[];
  howItWorks: HowItWorksContent;
  dossier: DossierContent;
  dupeHunter: DupeHunterContent;
  community: CommunityContent;
  finalCta: FinalCtaContent;
  footer: FooterContent;
};
