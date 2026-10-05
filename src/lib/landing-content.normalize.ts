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
 *  - colours must be `#RRGGBB` (they become an inline style);
 *  - hidden content is left out, not just flagged: loader data is serialized
 *    into the page, so anything returned here is readable in its source.
 *    Hidden testimonials are dropped, and a hidden section that only the home
 *    page renders (`dailyPalette`, `concierge`, `feed`, `finalCta`) carries no
 *    copy. `howItWorks`, `dossier`, `dupeHunter`, `community` and `pricing`
 *    keep theirs: `hidden` only takes them off the home page, and each has a
 *    page of its own that still renders it.
 */

export type SanityTarget = { projectId: string; dataset: string };

/** Fixed singleton id shared with the Studio (`MILA_STUDIO`). */
export const LANDING_DOCUMENT_ID = "landingPage";

const IMAGE = `{"url": asset->url, alt}`;

/**
 * GROQ projection: exactly the fields the page renders. `defined(howItWorks)`
 * keeps out the sibling product's document: LINARA shares this Sanity
 * organization, the env var names and the document id, but has no such section.
 */
export const LANDING_QUERY = `*[_id == "${LANDING_DOCUMENT_ID}" && defined(howItWorks)][0]{
  seo{title, description, socialDescription},
  cta{signedOutLabel, signedInLabel},
  hero{
    kicker, headlineLine1, headlineLine2, subhead, ctaNote,
    preview{season, weather},
    "image": image${IMAGE}, imageCaption
  },
  testimonials[]{_key, name, season, quote},
  howItWorks{hidden, heading, steps[]{_key, number, title, body}},
  dossier{
    hidden, heading, body, cardTitle, season,
    rows[]{_key, label, value},
    completionLabel, completionPercent,
    "image": image${IMAGE}
  },
  dailyPalette{hidden, heading, body, "image": image${IMAGE}, swatches[]{_key, label, hex}},
  concierge{hidden, heading, body, "image": image${IMAGE}, exchange[]{_key, role, text}},
  dupeHunter{
    hidden, heading, body,
    inspiration{label, title, price, "image": image${IMAGE}},
    milaMatch{label, title, price, "image": image${IMAGE}}
  },
  feed{hidden, heading, body, images[]{_key, "url": asset->url, alt}},
  community{hidden, hideTestimonials, heading, body, seasonChips},
  pricing{hidden, heading, body},
  finalCta{hidden, heading, body, privacyNote, "backgroundImage": backgroundImage${IMAGE}},
  subpageCta{heading},
  footer{wordmark, tagline}
}`;

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function obj(value: unknown): Obj {
  return isObj(value) ? value : {};
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

const CDN_ORIGIN = "https://cdn.sanity.io";

/** Never present in an asset URL; each is a way to smuggle a different path. */
const UNSAFE_URL_CHARS = /[\\%\s\p{Cc}]/u;

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `/images/<projectId>/<dataset>/<assetId>-<width>x<height>.<ext>`, nothing else. */
function assetPath(target: SanityTarget): RegExp | null {
  if (!target.projectId || !target.dataset) return null;
  const folder = `${escapeRegExp(target.projectId)}/${escapeRegExp(target.dataset)}`;
  return new RegExp(`^/images/${folder}/[A-Za-z0-9]+-\\d+x\\d+\\.[a-z0-9]+$`);
}

/** A Sanity CDN URL from this project, sized for the page; otherwise null. */
function cdnUrl(value: unknown, target: SanityTarget, width: number): string | null {
  if (typeof value !== "string" || UNSAFE_URL_CHARS.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // The parser resolves `..`, drops a default port and hides a bare `?` or `#`.
  // Requiring the stored value to BE its parsed form means none of that
  // happened: https, this exact host, no credentials, port, query or fragment.
  if (value !== `${CDN_ORIGIN}${url.pathname}`) return null;
  if (!assetPath(target)?.test(url.pathname)) return null;
  return `${value}?auto=format&fit=max&w=${width}`;
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

/** The image of a hidden section: nothing to send, and nothing renders it. */
function noImage(): LandingImage {
  return { src: "", alt: "" };
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
      },
      image: image(hero.image, F.hero.image, target, 1800),
      imageCaption: str(hero.imageCaption, F.hero.imageCaption),
    },
    testimonials: flag(community.hideTestimonials)
      ? []
      : list<Testimonial>(
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
    dailyPalette: flag(palette.hidden)
      ? { hidden: true, heading: "", body: "", image: noImage(), swatches: [] }
      : {
          hidden: false,
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
    concierge: flag(concierge.hidden)
      ? { hidden: true, heading: "", body: "", image: noImage(), exchange: [] }
      : {
          hidden: false,
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
      heading: str(dupe.heading, F.dupeHunter.heading),
      body: str(dupe.body, F.dupeHunter.body),
      inspiration: dupeCard(dupe.inspiration, F.dupeHunter.inspiration, target),
      milaMatch: dupeCard(dupe.milaMatch, F.dupeHunter.milaMatch, target),
    },
    feed: flag(feed.hidden)
      ? { hidden: true, heading: "", body: "", images: [] }
      : {
          hidden: false,
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
    finalCta: flag(finalCta.hidden)
      ? { hidden: true, heading: "", body: "", privacyNote: "", backgroundImage: noImage() }
      : {
          hidden: false,
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
  /**
   * Runs `LANDING_QUERY`; injected so tests never touch the network. `signal`
   * aborts when the read outlives its deadline and must cancel the request.
   */
  fetchDocument: (signal: AbortSignal) => Promise<unknown>;
  /** `null` when SANITY_PROJECT_ID / SANITY_DATASET are not configured. */
  target: SanityTarget | null;
  warn: (...args: unknown[]) => void;
  /**
   * Error tracker (Sentry in production); gets each failed read's error, and
   * once per loader the error saying Sanity is not configured.
   */
  report: (error: unknown) => void;
};

/** Time source for a loader; injected so tests never wait on a real timer. */
export type LandingClock = {
  /** Milliseconds on a clock that only moves forward; only differences matter. */
  now: () => number;
  /** Runs `callback` after `ms`; the returned function cancels it. */
  after: (ms: number, callback: () => void) => () => void;
};

const SYSTEM_CLOCK: LandingClock = {
  // Monotonic, unlike Date.now(): a step of the wall clock (NTP, a VM resuming)
  // must neither skip nor stretch the quiet period after a failure.
  now: () => performance.now(),
  after: (ms, callback) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};

export type LandingLoader = (options: LoadLandingOptions) => Promise<LandingContent>;

/** A page render waits this long for Sanity, then serves what it has. */
const LANDING_READ_TIMEOUT_MS = 4_000;

/** After a failed read, pages serve what they have this long before retrying. */
const LANDING_RETRY_AFTER_MS = 30_000;

/** A failure this module raises itself, so its message is safe to log. */
class LandingReadError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/**
 * What a warning may say about a failure: the error's name, its HTTP status
 * when it carries one, and the message only when this module wrote it. An
 * upstream message is never logged (it can carry request details).
 */
function describeFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  // @sanity/client's ClientError (4xx) and ServerError (5xx) carry `statusCode`.
  // src: https://github.com/sanity-io/client/blob/v7.26.0/src/http/errors.ts · @sanity/client 7.26.0 · 2026-10-05
  const status = obj(error).statusCode;
  const http = typeof status === "number" && Number.isInteger(status) ? `, HTTP ${status}` : "";
  const detail = error instanceof LandingReadError ? `: ${error.message}` : "";
  return `${name}${http}${detail}`;
}

function reportSafely(report: LoadLandingOptions["report"], error: unknown): void {
  try {
    report(error);
  } catch {
    // The page outranks the report: a broken reporter must not take it down.
  }
}

/**
 * Runs the read against a deadline. The race settles on the deadline even if
 * the read ignores its signal; the abort then cancels the in-flight request.
 */
async function readWithDeadline(
  fetchDocument: LoadLandingOptions["fetchDocument"],
  clock: LandingClock,
): Promise<unknown> {
  const controller = new AbortController();
  let cancelDeadline = () => {};
  const deadline = new Promise<never>((_, reject) => {
    cancelDeadline = clock.after(LANDING_READ_TIMEOUT_MS, () => {
      // Reject first, so the race settles on the timeout and not on the
      // AbortError the cancelled read answers with.
      reject(
        new LandingReadError(
          "LandingTimeoutError",
          `no answer within ${LANDING_READ_TIMEOUT_MS}ms`,
        ),
      );
      controller.abort();
    });
  });
  try {
    return await Promise.race([fetchDocument(controller.signal), deadline]);
  } finally {
    cancelDeadline();
  }
}

/**
 * Builds the loader one server instance keeps. Fetch + normalize, never
 * throwing and never waiting past `LANDING_READ_TIMEOUT_MS`.
 *
 * A read that throws, times out, finds no published document or finds another
 * product's is a failure. A failure serves the last content this loader read,
 * so an outage does not un-hide sections or revert edits; before any read has
 * succeeded it serves the checked-in copy. The failure warns once and is
 * reported once, then Sanity is left alone for `LANDING_RETRY_AFTER_MS`.
 * The upstream error message is not logged (it can carry request details).
 * Without a target (SANITY_* unset) every call serves the checked-in copy,
 * and the loader warns and reports that once.
 *
 * One read at a time: callers that arrive while it runs share it, or get the
 * last good copy at once when there is one, so an outage costs one read and
 * one deadline, not one per visitor. With no overlap, reads finish in the
 * order they start, and a read abandoned at its deadline can no longer
 * change anything (`readWithDeadline`).
 */
export function createLandingLoader(clock: LandingClock = SYSTEM_CLOCK): LandingLoader {
  // Held by the loader, never module scope, so every loader (one per server
  // instance, one per test) has its own memory.
  let lastGood: LandingContent | null = null;
  let retryAt = 0;
  let reading: Promise<void> | null = null;
  let unconfiguredReported = false;

  // Always a copy: a caller that mutates what it was served can't reach this.
  const stale = () => structuredClone(lastGood ?? LANDING_FALLBACK);

  /** One read: a new last good copy, or a failure and the quiet period. Never throws. */
  async function read(
    { fetchDocument, warn, report }: LoadLandingOptions,
    target: SanityTarget,
  ): Promise<void> {
    try {
      const raw = await readWithDeadline(fetchDocument, clock);
      if (!isObj(raw)) {
        throw new LandingReadError(
          "LandingDocumentError",
          `no published "${LANDING_DOCUMENT_ID}" document`,
        );
      }
      // Second check behind the query's filter: a mispointed SANITY_PROJECT_ID
      // must never put another product's hero and SEO text on MILA's page.
      if (!isObj(raw.howItWorks)) {
        throw new LandingReadError(
          "LandingDocumentError",
          "the document does not look like MILA's, it has no howItWorks section; check SANITY_PROJECT_ID",
        );
      }
      lastGood = normalizeLandingContent(raw, target);
    } catch (error) {
      retryAt = clock.now() + LANDING_RETRY_AFTER_MS;
      const serving = lastGood
        ? "the last good content"
        : `fallback copy v${LANDING_FALLBACK_VERSION}`;
      warn(
        `[landing] Sanity read failed (${describeFailure(error)}) for ${target.projectId}/${target.dataset}; serving ${serving}, next attempt in ${LANDING_RETRY_AFTER_MS / 1000}s.`,
      );
      reportSafely(report, error);
    }
  }

  return async function loadLandingContent(options) {
    const { target, warn, report } = options;

    if (!target) {
      // Said once per instance: it holds for every request this instance serves,
      // and without the report a deployment missing its env vars would drop
      // every Studio publish without anyone noticing.
      if (!unconfiguredReported) {
        unconfiguredReported = true;
        warn(
          `[landing] Sanity is not configured (SANITY_PROJECT_ID / SANITY_DATASET unset); this server instance serves fallback copy v${LANDING_FALLBACK_VERSION} and will not say so again.`,
        );
        reportSafely(
          report,
          new LandingReadError(
            "LandingConfigError",
            "SANITY_PROJECT_ID / SANITY_DATASET are not set, so Studio publishes never reach the landing page",
          ),
        );
      }
      return stale();
    }

    // Still inside the quiet period after a failure: no read, no second warning.
    if (clock.now() < retryAt) return stale();

    if (!reading) {
      reading = read(options, target).finally(() => {
        reading = null;
      });
    } else if (lastGood) {
      // Someone else's read is under way: a page served now beats one served
      // after Sanity answers, and it is at most one read behind.
      return stale();
    }
    await reading;
    return stale();
  };
}
