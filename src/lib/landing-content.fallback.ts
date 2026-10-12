import type { LandingContent } from "@/lib/landing-content";

/**
 * Checked-in landing copy. Used field-by-field when the published Sanity
 * document lacks a field (older documents, new sections not yet populated) and
 * wholesale when Sanity can't be read and this server has no earlier good read
 * to serve instead, so the public page never goes blank.
 *
 * Text is the published `landingPage` document as read on 2026-10-04
 * (`_rev AbE0eRTxRWYSaELT1T6WPq`) plus the copy that was hard-coded in the
 * landing components at `f2bbde5`, with the 2026-10-07 copy pass on top: one
 * locale (US spelling, dollars, Fahrenheit), no em or en dashes, and claims
 * that match what ships. Images are the static files in `public/`.
 * Keep this in step with the Studio seed (`MILA_STUDIO/seed/landing-snapshot.json`);
 * the test suite holds it against the real documents in `__fixtures__/`: the
 * legacy project's (`landing.legacy-8bkzi9bn.json`) and the Studio's
 * (`landing.published-8gum36g6.json`). Copy changed here and not yet
 * published in the Studio is listed in that test as pending.
 */
export const LANDING_FALLBACK_VERSION = "2026-10-07";

export const LANDING_FALLBACK: LandingContent = {
  seo: {
    title: "Mila: Your stylist. Every morning.",
    description: "Your AI personal stylist. Daily outfits built on your color season and shape.",
    socialDescription:
      "Mila composes your daily look around your color season, your silhouette, and the weather outside.",
  },
  cta: {
    // The once-ever color read is free; a look needs a membership.
    signedOutLabel: "Start with your colors",
    signedInLabel: "Open the studio",
  },
  hero: {
    kicker: "Your AI stylist",
    headlineLine1: "Your stylist.",
    headlineLine2: "Every morning.",
    subhead:
      "Mila composes your daily look around your color season, your silhouette, and the weather outside.",
    // Closes the sub-copy paragraph (it no longer sits under the button).
    ctaNote: "Personalized guidance, no appointment needed.",
    preview: {
      season: "True Summer",
      weather: "64°F · Light rain",
    },
    image: {
      src: "/hero-style-sheet.png",
      alt: "Identity-locked style sheet in five views: face close-up, front, back, left profile, and right profile",
    },
    imageCaption: "Identity-locked style sheet. Five angles, one you.",
  },
  testimonials: [
    {
      _key: "amara",
      name: "Amara",
      season: "True Summer",
      quote: "I'm a True Summer and I finally know what to actually buy.",
    },
    {
      _key: "jess",
      name: "Jess",
      season: "Soft Autumn",
      quote: "Mila nailed my face shape on the first try.",
    },
    {
      _key: "priya",
      name: "Priya",
      season: "Deep Winter",
      quote: "I used to just grab 'a red.' Now I know which red is actually mine.",
    },
    {
      _key: "sofia",
      name: "Sofia",
      season: "Light Spring",
      quote: "One tap before work and I've stopped second-guessing myself in the mirror.",
    },
    {
      _key: "renee",
      name: "Renee",
      season: "True Autumn",
      quote: "First app that's straight with me about my shape instead of dancing around it.",
    },
  ],
  howItWorks: {
    hidden: false,
    heading: "Three steps to dressed",
    steps: [
      {
        _key: "step01",
        number: "01",
        title: "Tell Mila who you are",
        body: "A short style profile, about five minutes. Your color season, your silhouette, your features.",
      },
      {
        _key: "step02",
        number: "02",
        title: "Get your look",
        body: "Outfit, hair, and makeup for today, tuned to your palette and the weather outside.",
      },
      {
        _key: "step03",
        number: "03",
        title: "Post and discover",
        body: "Share your look and see what other members are wearing today.",
      },
    ],
  },
  dossier: {
    hidden: false,
    heading: "The more Mila knows you, the better she dresses you.",
    body: "Your dossier is a living profile: color season, body silhouette, face shape, hair texture, beauty preferences. Every recommendation is anchored to it, and it gets more precise every day you use it.",
    cardTitle: "Digital Style Dossier",
    season: "True Summer",
    rows: [
      { _key: "season", label: "Color season", value: "True Summer: cool, muted, soft" },
      { _key: "silhouette", label: "Silhouette", value: "Inverted triangle" },
      { _key: "beauty", label: "Beauty profile", value: "Wavy hair · warm-neutral skin" },
    ],
    completionLabel: "Dossier completion",
    completionPercent: 80,
    image: {
      src: "/landing/dossier-example.jpg",
      alt: "Editorial photograph of a True Summer palette outfit in soft blue-gray and dusty rose",
    },
  },
  dailyPalette: {
    hidden: false,
    heading: "A new color mix, every morning.",
    body: "Three colors pulled fresh from your season each day (base, statement, and accent), so you never second-guess what goes together.",
    image: {
      src: "/landing/palette-flatlay.jpg",
      alt: "Flat-lay of camel, deep berry, and gold garments: one day's color palette",
    },
    swatches: [
      { _key: "base", label: "Base Layer", hex: "#D8C4A0" },
      { _key: "statement", label: "Statement", hex: "#8B4A62" },
      { _key: "accent", label: "Accent Pop", hex: "#C9A227" },
    ],
  },
  concierge: {
    hidden: false,
    heading: "Ask Mila anything, anytime.",
    body: "Not sure about a pairing? Stuck between two looks? Mila knows your dossier and can talk through any look you've saved. Just ask.",
    image: {
      src: "/landing/concierge-garment.jpg",
      alt: "Close-up of a black wool coat with a pair of gold hoop earrings resting on the lapel",
    },
    exchange: [
      {
        _key: "question",
        role: "user",
        text: "What do I pair with this coat for a dinner tonight?",
      },
      {
        _key: "answer",
        role: "assistant",
        text: "Swap the sneakers for your black block heels, and add the gold hoops from your dossier. It keeps the silhouette elongated under low light.",
      },
    ],
  },
  dupeHunter: {
    hidden: false,
    heading: "Mila found the dupe. You keep $340.",
    body: "Photograph any fashion item and Mila finds an affordable alternative. Same look, a fraction of the price.",
    inspiration: {
      label: "The inspiration",
      title: "Camel wool coat",
      price: "$420",
      // An editorial shot, so it reads apart from the match's catalog shot.
      image: {
        src: "/landing/final-cta-bg.jpg",
        alt: "The inspiration: an editorial photo of a woman in a camel wool coat over a silk blouse",
      },
    },
    milaMatch: {
      label: "Mila's match",
      title: "Same color, same drape",
      price: "$80",
      image: {
        src: "/landing/dupe-match.jpg",
        alt: "Mila's match: a long camel coat with a tie belt, at a fraction of the price",
      },
    },
  },
  feed: {
    hidden: false,
    heading: "Post today's fit. See everyone else's.",
    body: "One photo, tagged automatically. Every piece becomes shoppable for the whole community.",
    images: [
      {
        _key: "feed-1",
        src: "/landing/feed-1.jpg",
        alt: "Outfit post: warm autumn palette, olive and cream",
      },
      {
        _key: "feed-2",
        src: "/landing/feed-2.jpg",
        alt: "Outfit post: cool winter palette, charcoal and white",
      },
      {
        _key: "feed-3",
        src: "/landing/feed-3.jpg",
        alt: "Outfit post: soft spring palette, coral sundress",
      },
      {
        _key: "feed-4",
        src: "/landing/feed-4.jpg",
        alt: "Outfit post: deep summer palette, navy and blush",
      },
    ],
  },
  community: {
    hidden: false,
    hideTestimonials: false,
    heading: "Real outfits, not whatever's trending.",
    body: "Members post what they really wore today, straight from the mirror. Browse every look and share yours whenever you like. Everyone here dresses with intention.",
    seasonChips: ["True Summer", "Soft Autumn", "Deep Winter", "Light Spring"],
  },
  pricing: {
    hidden: false,
    heading: "Choose your Atelier access.",
    body: "Every plan includes daily styling credits and a verified badge on your profile.",
  },
  finalCta: {
    hidden: false,
    heading: "Style that knows you.",
    body: "Build your style profile and get your free color read. Your looks come with a membership.",
    privacyNote: "Your profile stays private. Always.",
    // Decorative backdrop: empty alt on purpose. Not final-cta-bg.jpg, which is
    // now the dupe inspiration, so no photo repeats on the page.
    backgroundImage: { src: "/landing/dupe-inspiration.jpg", alt: "" },
  },
  subpageCta: { heading: "Ready for your color read?" },
  footer: { wordmark: "MILA", tagline: "Your AI stylist. Every morning." },
};
