import type {
  ConciergeMessage,
  DossierRow,
  DupeCard,
  FeedImage,
  LandingContent,
  LandingImage,
  PaletteSwatch,
  Step,
  Testimonial,
} from "@/lib/landing-content";
import { LANDING_FALLBACK, LANDING_FALLBACK_VERSION } from "@/lib/landing-content.fallback";

/**
 * Pure validation for the Sanity `landingPage` document. No Sanity client
 * import here, so it runs in unit tests and never pulls server code into a
 * browser chunk. Rules:
 *  - every field falls back to `LANDING_FALLBACK` on its own when missing,
 *    blank or the wrong type, so an older document renders the current page;
 *  - only fields named below reach the page (no prices, URLs or HTML);
 *  - images must come from THIS project's Sanity CDN and carry alt text;
 *  - colours must be `#RRGGBB` (they become an inline style).
 */

export type SanityTarget = { projectId: string; dataset: string };

/** Fixed singleton id shared with the Studio (`MILA_STUDIO`). */
export const LANDING_DOCUMENT_ID = "landingPage";

const IMAGE = `{"url": asset->url, alt}`;

/** GROQ projection: exactly the fields the page renders. */
export const LANDING_QUERY = `*[_id == "${LANDING_DOCUMENT_ID}"][0]{
  seo{title, description, socialDescription},
  cta{signedOutLabel, signedInLabel},
  hero{
    kicker, headlineLine1, headlineLine2, subhead, ctaNote,
    preview{season, weather, outfitTitle, outfitBody, hair, makeup},
    "image": image${IMAGE}, imageCaption
  },
  testimonials[]{_key, name, season, quote},
  howItWorks{hidden, kicker, heading, steps[]{_key, number, title, body}},
  dossier{
    hidden, kicker, heading, body, cardTitle, season,
    rows[]{_key, label, value},
    completionLabel, completionPercent,
    "image": image${IMAGE}
  },
  dailyPalette{hidden, heading, body, "image": image${IMAGE}, swatches[]{_key, label, hex}},
  concierge{hidden, heading, body, "image": image${IMAGE}, exchange[]{_key, role, text}},
  dupeHunter{
    hidden, kicker, heading, body,
    inspiration{label, title, price, "image": image${IMAGE}},
    milaMatch{label, title, price, "image": image${IMAGE}}
  },
  feed{hidden, heading, body, images[]{_key, "url": asset->url, alt}},
  community{hidden, hideTestimonials, kicker, heading, body, seasonChips},
  pricing{hidden, heading, body},
  finalCta{hidden, heading, body, privacyNote, "backgroundImage": backgroundImage${IMAGE}},
  subpageCta{heading},
  footer{wordmark, tagline}
}`;

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function str(value: unknown, fallback: string): string {
  return text(value) ?? fallback;
}

function flag(value: unknown): boolean {
  return value === true;
}

function key(item: Obj, index: number): string {
  return text(item._key) ?? `item-${index}`;
}

/** Valid items only; if none survive, the fallback list (copied). */
function list<T>(
  value: unknown,
  parse: (item: Obj, index: number) => T | null,
  fallback: T[],
): T[] {
  if (!Array.isArray(value)) return structuredClone(fallback);
  const items = value
    .map((item, index) => (item && typeof item === "object" ? parse(item as Obj, index) : null))
    .filter((item): item is T => item !== null);
  return items.length ? items : structuredClone(fallback);
}

const HEX = /^#[0-9a-f]{6}$/i;

function cdnPrefix(target: SanityTarget): string {
  return `https://cdn.sanity.io/images/${target.projectId}/${target.dataset}/`;
}

/** A Sanity CDN URL from this project, sized for the page; otherwise null. */
function cdnUrl(value: unknown, target: SanityTarget, width: number): string | null {
  const url = text(value);
  if (!url || !url.startsWith(cdnPrefix(target)) || /[\s"'<>?#]/.test(url)) return null;
  return `${url}?auto=format&fit=max&w=${width}`;
}

function image(
  value: unknown,
  fallback: LandingImage,
  target: SanityTarget,
  width: number,
  decorative = false,
): LandingImage {
  const raw = obj(value);
  const src = cdnUrl(raw.url, target, width);
  const alt = decorative ? (text(raw.alt) ?? "") : text(raw.alt);
  return src && alt !== null ? { src, alt } : { ...fallback };
}

function dupeCard(value: unknown, fallback: DupeCard, target: SanityTarget): DupeCard {
  const raw = obj(value);
  return {
    label: str(raw.label, fallback.label),
    title: str(raw.title, fallback.title),
    price: str(raw.price, fallback.price),
    image: image(raw.image, fallback.image, target, 960),
  };
}

export function normalizeLandingContent(raw: unknown, target: SanityTarget): LandingContent {
  const F = LANDING_FALLBACK;
  const doc = obj(raw);

  const seo = obj(doc.seo);
  const cta = obj(doc.cta);
  const hero = obj(doc.hero);
  const preview = obj(hero.preview);
  const how = obj(doc.howItWorks);
  const dossier = obj(doc.dossier);
  const palette = obj(doc.dailyPalette);
  const concierge = obj(doc.concierge);
  const dupe = obj(doc.dupeHunter);
  const feed = obj(doc.feed);
  const community = obj(doc.community);
  const pricing = obj(doc.pricing);
  const finalCta = obj(doc.finalCta);
  const subpageCta = obj(doc.subpageCta);
  const footer = obj(doc.footer);

  const percent = dossier.completionPercent;
  const completionPercent =
    typeof percent === "number" && Number.isInteger(percent) && percent >= 0 && percent <= 100
      ? percent
      : F.dossier.completionPercent;

  return {
    seo: {
      title: str(seo.title, F.seo.title),
      description: str(seo.description, F.seo.description),
      socialDescription: str(seo.socialDescription, F.seo.socialDescription),
    },
    cta: {
      signedOutLabel: str(cta.signedOutLabel, F.cta.signedOutLabel),
      signedInLabel: str(cta.signedInLabel, F.cta.signedInLabel),
    },
    hero: {
      kicker: str(hero.kicker, F.hero.kicker),
      headlineLine1: str(hero.headlineLine1, F.hero.headlineLine1),
      headlineLine2: str(hero.headlineLine2, F.hero.headlineLine2),
      subhead: str(hero.subhead, F.hero.subhead),
      ctaNote: str(hero.ctaNote, F.hero.ctaNote),
      preview: {
        season: str(preview.season, F.hero.preview.season),
        weather: str(preview.weather, F.hero.preview.weather),
        outfitTitle: str(preview.outfitTitle, F.hero.preview.outfitTitle),
        outfitBody: str(preview.outfitBody, F.hero.preview.outfitBody),
        hair: str(preview.hair, F.hero.preview.hair),
        makeup: str(preview.makeup, F.hero.preview.makeup),
      },
      image: image(hero.image, F.hero.image, target, 1800),
      imageCaption: str(hero.imageCaption, F.hero.imageCaption),
    },
    testimonials: list<Testimonial>(
      doc.testimonials,
      (t, i) => {
        const name = text(t.name);
        const season = text(t.season);
        const quote = text(t.quote);
        return name && season && quote ? { _key: key(t, i), name, season, quote } : null;
      },
      F.testimonials,
    ),
    howItWorks: {
      hidden: flag(how.hidden),
      kicker: str(how.kicker, F.howItWorks.kicker),
      heading: str(how.heading, F.howItWorks.heading),
      steps: list<Step>(
        how.steps,
        (s, i) => {
          const number = text(s.number);
          const title = text(s.title);
          const body = text(s.body);
          return number && title && body ? { _key: key(s, i), number, title, body } : null;
        },
        F.howItWorks.steps,
      ),
    },
    dossier: {
      hidden: flag(dossier.hidden),
      kicker: str(dossier.kicker, F.dossier.kicker),
      heading: str(dossier.heading, F.dossier.heading),
      body: str(dossier.body, F.dossier.body),
      cardTitle: str(dossier.cardTitle, F.dossier.cardTitle),
      season: str(dossier.season, F.dossier.season),
      rows: list<DossierRow>(
        dossier.rows,
        (r, i) => {
          const label = text(r.label);
          const value = text(r.value);
          return label && value ? { _key: key(r, i), label, value } : null;
        },
        F.dossier.rows,
      ),
      completionLabel: str(dossier.completionLabel, F.dossier.completionLabel),
      completionPercent,
      image: image(dossier.image, F.dossier.image, target, 960),
    },
    dailyPalette: {
      hidden: flag(palette.hidden),
      heading: str(palette.heading, F.dailyPalette.heading),
      body: str(palette.body, F.dailyPalette.body),
      image: image(palette.image, F.dailyPalette.image, target, 960),
      swatches: list<PaletteSwatch>(
        palette.swatches,
        (s, i) => {
          const label = text(s.label);
          const hex = text(s.hex);
          return label && hex && HEX.test(hex)
            ? { _key: key(s, i), label, hex: hex.toUpperCase() }
            : null;
        },
        F.dailyPalette.swatches,
      ),
    },
    concierge: {
      hidden: flag(concierge.hidden),
      heading: str(concierge.heading, F.concierge.heading),
      body: str(concierge.body, F.concierge.body),
      image: image(concierge.image, F.concierge.image, target, 960),
      exchange: list<ConciergeMessage>(
        concierge.exchange,
        (m, i) => {
          const body = text(m.text);
          return body && (m.role === "user" || m.role === "assistant")
            ? { _key: key(m, i), role: m.role, text: body }
            : null;
        },
        F.concierge.exchange,
      ),
    },
    dupeHunter: {
      hidden: flag(dupe.hidden),
      kicker: str(dupe.kicker, F.dupeHunter.kicker),
      heading: str(dupe.heading, F.dupeHunter.heading),
      body: str(dupe.body, F.dupeHunter.body),
      inspiration: dupeCard(dupe.inspiration, F.dupeHunter.inspiration, target),
      milaMatch: dupeCard(dupe.milaMatch, F.dupeHunter.milaMatch, target),
    },
    feed: {
      hidden: flag(feed.hidden),
      heading: str(feed.heading, F.feed.heading),
      body: str(feed.body, F.feed.body),
      images: list<FeedImage>(
        feed.images,
        (img, i) => {
          const src = cdnUrl(img.url, target, 720);
          const alt = text(img.alt);
          return src && alt ? { _key: key(img, i), src, alt } : null;
        },
        F.feed.images,
      ),
    },
    community: {
      hidden: flag(community.hidden),
      hideTestimonials: flag(community.hideTestimonials),
      kicker: str(community.kicker, F.community.kicker),
      heading: str(community.heading, F.community.heading),
      body: str(community.body, F.community.body),
      seasonChips: (() => {
        const chips = Array.isArray(community.seasonChips)
          ? community.seasonChips.map(text).filter((c): c is string => c !== null)
          : [];
        return chips.length ? chips : [...F.community.seasonChips];
      })(),
    },
    pricing: {
      hidden: flag(pricing.hidden),
      heading: str(pricing.heading, F.pricing.heading),
      body: str(pricing.body, F.pricing.body),
    },
    finalCta: {
      hidden: flag(finalCta.hidden),
      heading: str(finalCta.heading, F.finalCta.heading),
      body: str(finalCta.body, F.finalCta.body),
      privacyNote: str(finalCta.privacyNote, F.finalCta.privacyNote),
      backgroundImage: image(
        finalCta.backgroundImage,
        F.finalCta.backgroundImage,
        target,
        2000,
        true,
      ),
    },
    subpageCta: { heading: str(subpageCta.heading, F.subpageCta.heading) },
    footer: {
      wordmark: str(footer.wordmark, F.footer.wordmark),
      tagline: str(footer.tagline, F.footer.tagline),
    },
  };
}

export type LoadLandingOptions = {
  /** Runs `LANDING_QUERY`; injected so tests never touch the network. */
  fetchDocument: () => Promise<unknown>;
  /** `null` when SANITY_PROJECT_ID / SANITY_DATASET are not configured. */
  target: SanityTarget | null;
  warn: (...args: unknown[]) => void;
};

/**
 * Fetch + normalize, never throwing: an outage, missing config or unpublished
 * document renders the checked-in copy and logs one server-side warning.
 * The upstream error message is not logged (it can carry request details).
 */
export async function loadLandingContent(options: LoadLandingOptions): Promise<LandingContent> {
  const { fetchDocument, target, warn } = options;
  const fallback = () => normalizeLandingContent(null, target ?? { projectId: "", dataset: "" });

  if (!target) {
    warn(`[landing] Sanity is not configured; serving fallback copy v${LANDING_FALLBACK_VERSION}.`);
    return fallback();
  }

  try {
    const raw = await fetchDocument();
    if (!raw) {
      warn(
        `[landing] No published "${LANDING_DOCUMENT_ID}" in ${target.projectId}/${target.dataset}; serving fallback copy v${LANDING_FALLBACK_VERSION}.`,
      );
      return fallback();
    }
    return normalizeLandingContent(raw, target);
  } catch (error) {
    const kind = error instanceof Error ? error.name : typeof error;
    warn(
      `[landing] Sanity read failed (${kind}) for ${target.projectId}/${target.dataset}; serving fallback copy v${LANDING_FALLBACK_VERSION}.`,
    );
    return fallback();
  }
}
