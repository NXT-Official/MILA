import { describe, expect, test } from "bun:test";
import { LANDING_FALLBACK } from "./landing-content.fallback";
import {
  LANDING_QUERY,
  loadLandingContent,
  normalizeLandingContent,
  type SanityTarget,
} from "./landing-content.normalize";

const TARGET: SanityTarget = { projectId: "8bkzi9bn", dataset: "production" };
const CDN = "https://cdn.sanity.io/images/8bkzi9bn/production/abc123-1600x900.jpg";

/** The published document as it existed before the Studio added new groups. */
const LEGACY_DOC = {
  hero: {
    kicker: LANDING_FALLBACK.hero.kicker,
    headlineLine1: LANDING_FALLBACK.hero.headlineLine1,
    headlineLine2: LANDING_FALLBACK.hero.headlineLine2,
    subhead: LANDING_FALLBACK.hero.subhead,
    ctaNote: LANDING_FALLBACK.hero.ctaNote,
    preview: LANDING_FALLBACK.hero.preview,
  },
  testimonials: LANDING_FALLBACK.testimonials,
  howItWorks: {
    kicker: LANDING_FALLBACK.howItWorks.kicker,
    heading: LANDING_FALLBACK.howItWorks.heading,
    steps: LANDING_FALLBACK.howItWorks.steps,
  },
  dossier: {
    ...LANDING_FALLBACK.dossier,
    hidden: undefined,
    image: undefined,
  },
  dupeHunter: {
    kicker: LANDING_FALLBACK.dupeHunter.kicker,
    heading: LANDING_FALLBACK.dupeHunter.heading,
    body: LANDING_FALLBACK.dupeHunter.body,
    inspiration: { label: "The inspiration", title: "Wool-blend maxi coat", price: "£420" },
    milaMatch: { label: "Mila's match", title: "Same cut, same drape", price: "£80" },
  },
  community: {
    kicker: LANDING_FALLBACK.community.kicker,
    heading: LANDING_FALLBACK.community.heading,
    body: LANDING_FALLBACK.community.body,
    seasonChips: LANDING_FALLBACK.community.seasonChips,
  },
  finalCta: {
    heading: LANDING_FALLBACK.finalCta.heading,
    body: LANDING_FALLBACK.finalCta.body,
    privacyNote: LANDING_FALLBACK.finalCta.privacyNote,
  },
  footer: LANDING_FALLBACK.footer,
};

describe("normalizeLandingContent", () => {
  test("the pre-Studio published document renders exactly the current page", () => {
    expect(normalizeLandingContent(LEGACY_DOC, TARGET)).toEqual(LANDING_FALLBACK);
  });

  test("null, undefined and non-objects give the full fallback", () => {
    expect(normalizeLandingContent(null, TARGET)).toEqual(LANDING_FALLBACK);
    expect(normalizeLandingContent(undefined, TARGET)).toEqual(LANDING_FALLBACK);
    expect(normalizeLandingContent("oops", TARGET)).toEqual(LANDING_FALLBACK);
    expect(normalizeLandingContent([], TARGET)).toEqual(LANDING_FALLBACK);
  });

  test("an edited field wins; its siblings keep their fallback", () => {
    const out = normalizeLandingContent({ hero: { headlineLine1: "Dressed by noon." } }, TARGET);
    expect(out.hero.headlineLine1).toBe("Dressed by noon.");
    expect(out.hero.headlineLine2).toBe(LANDING_FALLBACK.hero.headlineLine2);
    expect(out.dossier).toEqual(LANDING_FALLBACK.dossier);
  });

  test("blank, whitespace and wrong-type strings fall back", () => {
    const out = normalizeLandingContent(
      { hero: { kicker: "   ", subhead: 42, ctaNote: null } },
      TARGET,
    );
    expect(out.hero.kicker).toBe(LANDING_FALLBACK.hero.kicker);
    expect(out.hero.subhead).toBe(LANDING_FALLBACK.hero.subhead);
    expect(out.hero.ctaNote).toBe(LANDING_FALLBACK.hero.ctaNote);
  });

  test("strings are trimmed and HTML-looking text stays plain text", () => {
    const out = normalizeLandingContent(
      { finalCta: { heading: "  <img src=x onerror=alert(1)>  " } },
      TARGET,
    );
    expect(out.finalCta.heading).toBe("<img src=x onerror=alert(1)>");
  });

  test("hidden flags are only true for a literal true", () => {
    const out = normalizeLandingContent(
      { feed: { hidden: true }, concierge: { hidden: "true" }, community: { hideTestimonials: 1 } },
      TARGET,
    );
    expect(out.feed.hidden).toBe(true);
    expect(out.concierge.hidden).toBe(false);
    expect(out.community.hideTestimonials).toBe(false);
  });

  test("arrays: invalid items are dropped, an empty result falls back", () => {
    const out = normalizeLandingContent(
      {
        testimonials: [
          { _key: "a", name: "Ana", season: "Soft Summer", quote: "Real quote." },
          { _key: "b", name: "", season: "x", quote: "missing name" },
          "junk",
        ],
        howItWorks: { steps: [{ _key: "s", number: "01" }] },
      },
      TARGET,
    );
    expect(out.testimonials).toEqual([
      { _key: "a", name: "Ana", season: "Soft Summer", quote: "Real quote." },
    ]);
    expect(out.howItWorks.steps).toEqual(LANDING_FALLBACK.howItWorks.steps);
  });

  test("array items without a _key get a stable index key", () => {
    const out = normalizeLandingContent(
      { community: { seasonChips: ["Soft Summer", "", 3, "Deep Autumn"] } },
      TARGET,
    );
    expect(out.community.seasonChips).toEqual(["Soft Summer", "Deep Autumn"]);
    const steps = normalizeLandingContent(
      { howItWorks: { steps: [{ number: "01", title: "T", body: "B" }] } },
      TARGET,
    ).howItWorks.steps;
    expect(steps).toEqual([{ _key: "item-0", number: "01", title: "T", body: "B" }]);
  });

  test("completion percent must be a whole number 0–100", () => {
    for (const bad of [-1, 101, 50.5, "80", Number.NaN]) {
      const out = normalizeLandingContent({ dossier: { completionPercent: bad } }, TARGET);
      expect(out.dossier.completionPercent).toBe(LANDING_FALLBACK.dossier.completionPercent);
    }
    expect(
      normalizeLandingContent({ dossier: { completionPercent: 0 } }, TARGET).dossier
        .completionPercent,
    ).toBe(0);
  });

  test("images: only this project's Sanity CDN is accepted, alt is required", () => {
    const ok = normalizeLandingContent(
      { hero: { image: { url: CDN, alt: "A style sheet" } } },
      TARGET,
    );
    expect(ok.hero.image).toEqual({
      src: `${CDN}?auto=format&fit=max&w=1800`,
      alt: "A style sheet",
    });

    for (const image of [
      { url: "https://evil.example/x.jpg", alt: "x" },
      { url: "javascript:alert(1)", alt: "x" },
      { url: "https://cdn.sanity.io/images/otherproj/production/a.jpg", alt: "x" },
      { url: "https://cdn.sanity.io/images/8bkzi9bn/staging/a.jpg", alt: "x" },
      { url: CDN, alt: "  " },
      { url: CDN },
    ]) {
      const out = normalizeLandingContent({ hero: { image } }, TARGET);
      expect(out.hero.image).toEqual(LANDING_FALLBACK.hero.image);
    }
  });

  test("decorative images may have an empty alt", () => {
    const out = normalizeLandingContent({ finalCta: { backgroundImage: { url: CDN } } }, TARGET);
    expect(out.finalCta.backgroundImage.alt).toBe("");
    expect(out.finalCta.backgroundImage.src.startsWith(CDN)).toBe(true);
  });

  test("swatch colours must be #RRGGBB, so CMS text can't inject CSS", () => {
    const out = normalizeLandingContent(
      {
        dailyPalette: {
          swatches: [
            { _key: "a", label: "Ok", hex: "#aabbcc" },
            { _key: "b", label: "Bad", hex: "red; background:url(x)" },
          ],
        },
      },
      TARGET,
    );
    expect(out.dailyPalette.swatches).toEqual([{ _key: "a", label: "Ok", hex: "#AABBCC" }]);
  });

  test("concierge roles are limited to user/assistant", () => {
    const out = normalizeLandingContent(
      {
        concierge: {
          exchange: [
            { _key: "a", role: "system", text: "x" },
            { _key: "b", role: "assistant", text: "Hello" },
          ],
        },
      },
      TARGET,
    );
    expect(out.concierge.exchange).toEqual([{ _key: "b", role: "assistant", text: "Hello" }]);
  });

  test("feed images: an invalid image is dropped, not swapped for a stock one", () => {
    const out = normalizeLandingContent(
      {
        feed: {
          images: [
            { _key: "a", url: CDN, alt: "Look one" },
            { _key: "b", url: "https://evil.example/y.jpg", alt: "Look two" },
          ],
        },
      },
      TARGET,
    );
    expect(out.feed.images).toHaveLength(1);
    expect(out.feed.images[0]._key).toBe("a");
  });

  test("the output never shares mutable references with the fallback", () => {
    const out = normalizeLandingContent(null, TARGET);
    out.hero.preview.season = "changed";
    out.testimonials.push({ _key: "x", name: "x", season: "x", quote: "x" });
    expect(LANDING_FALLBACK.hero.preview.season).toBe("True Summer");
    expect(LANDING_FALLBACK.testimonials).toHaveLength(5);
  });

  test("extra, unknown fields (e.g. a price list or URL) never reach the output", () => {
    const out = normalizeLandingContent(
      { pricing: { heading: "Plans", price: "£0", href: "https://evil.example" }, ctaHref: "x" },
      TARGET,
    ) as unknown as Record<string, Record<string, unknown>>;
    expect(out.pricing).toEqual({
      hidden: false,
      heading: "Plans",
      body: LANDING_FALLBACK.pricing.body,
    });
    expect(out.ctaHref).toBeUndefined();
  });
});

describe("LANDING_QUERY", () => {
  test("projects every content group the page renders, by the singleton id", () => {
    expect(LANDING_QUERY).toContain('*[_id == "landingPage"][0]');
    for (const group of Object.keys(LANDING_FALLBACK)) {
      expect(LANDING_QUERY).toContain(group);
    }
    expect(LANDING_QUERY).toContain("asset->url");
  });
});

describe("loadLandingContent", () => {
  test("a fetch error gives the fallback and a server-side warning without secrets", async () => {
    const warnings: unknown[][] = [];
    const out = await loadLandingContent({
      fetchDocument: async () => {
        throw new Error("401 token=sk-secret-value");
      },
      target: TARGET,
      warn: (...args) => warnings.push(args),
    });
    expect(out).toEqual(LANDING_FALLBACK);
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain("sk-secret-value");
  });

  test("an unpublished document gives the fallback and a warning", async () => {
    const warnings: unknown[][] = [];
    const out = await loadLandingContent({
      fetchDocument: async () => null,
      target: TARGET,
      warn: (...args) => warnings.push(args),
    });
    expect(out).toEqual(LANDING_FALLBACK);
    expect(warnings).toHaveLength(1);
  });

  test("missing Sanity configuration gives the fallback instead of throwing", async () => {
    const warnings: unknown[][] = [];
    const out = await loadLandingContent({
      fetchDocument: async () => LEGACY_DOC,
      target: null,
      warn: (...args) => warnings.push(args),
    });
    expect(out).toEqual(LANDING_FALLBACK);
    expect(warnings).toHaveLength(1);
  });

  test("a published document is normalized", async () => {
    const out = await loadLandingContent({
      fetchDocument: async () => ({ hero: { kicker: "New kicker" } }),
      target: TARGET,
      warn: () => {},
    });
    expect(out.hero.kicker).toBe("New kicker");
  });
});
