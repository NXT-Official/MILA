import { describe, expect, test } from "bun:test";
// The result of LANDING_QUERY against the real published document: project
// 8bkzi9bn, dataset production, perspective=published, read anonymously on
// 2026-10-05. Public marketing copy only.
import LEGACY_DOCUMENT from "./__fixtures__/landing.legacy-8bkzi9bn.json";
import type { LandingContent } from "./landing-content";
import { LANDING_FALLBACK } from "./landing-content.fallback";
import {
  LANDING_QUERY,
  createLandingLoader,
  normalizeLandingContent,
  type SanityTarget,
} from "./landing-content.normalize";

const TARGET: SanityTarget = { projectId: "8bkzi9bn", dataset: "production" };
const CDN_FOLDER = "https://cdn.sanity.io/images/8bkzi9bn/production";
const CDN = `${CDN_FOLDER}/abc123-1600x900.jpg`;

/** A hand-driven clock: time and timers only move when the test says so. */
function fakeClock() {
  let time = 0;
  let timers: { at: number; run: () => void }[] = [];
  return {
    now: () => time,
    after(ms: number, run: () => void) {
      const timer = { at: time + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((t) => t !== timer);
      };
    },
    advance(ms: number) {
      time += ms;
      const due = timers.filter((t) => t.at <= time);
      timers = timers.filter((t) => t.at > time);
      for (const timer of due) timer.run();
    },
    pending: () => timers.length,
  };
}

/** Lets every already-queued promise callback run (no fake time passes). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A published MILA document carrying only `fields` (MILA's always has `howItWorks`). */
const milaDoc = (fields: Record<string, unknown>) => ({ howItWorks: {}, ...fields });

/** A published document an editor has changed: two sections hidden, one headline. */
const EDITED_DOC = {
  hero: { headlineLine1: "Dressed by noon." },
  howItWorks: { hidden: true, heading: "Three steps" },
  feed: { hidden: true },
};

/** One isolated loader whose next read the test scripts; records what it did. */
function scriptedLoader() {
  const clock = fakeClock();
  const load = createLandingLoader(clock);
  const seen = { fetches: 0, warnings: [] as string[], reports: [] as unknown[] };
  let read: (signal: AbortSignal) => Promise<unknown> = async () => EDITED_DOC;
  return {
    clock,
    seen,
    nextRead(next: (signal: AbortSignal) => Promise<unknown>) {
      read = next;
    },
    load: () =>
      load({
        fetchDocument: (signal) => {
          seen.fetches += 1;
          return read(signal);
        },
        target: TARGET,
        warn: (...args) => seen.warnings.push(args.join(" ")),
        report: (error) => seen.reports.push(error),
      }),
  };
}

const failWith = (error: unknown) => async () => {
  throw error;
};

/**
 * What MILA's query would read from LINARA's `landingPage`: the sibling product
 * shares the Sanity organization, the env var names and the document id.
 */
const LINARA_DOC = {
  seo: { title: "Linara — Home, made clear.", description: "x", socialDescription: "y" },
  header: { ctaLabel: "Open Manager Pass" },
  hero: {
    kicker: "Home, made clear.",
    headlineLine1: "Clarity over control.",
    headlineLine2: "Dignity by design.",
    description: "d",
    ctaLabel: "Start Household Pass",
  },
  kitchen: {},
  lenses: {},
  account: {},
  footer: {},
};

/** Every string anywhere inside `value`. */
function leafStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(leafStrings);
  return [];
}

const sentinelImage = (group: string) => `${CDN_FOLDER}/${group}Sentinel-10x10.jpg`;

/**
 * A published document in which every piece of copy, key and image names the
 * group it belongs to, so a serialized payload shows exactly whose content it carries.
 */
const SENTINEL_DOC = {
  hero: { headlineLine1: "hero sentinel headline" },
  testimonials: [
    {
      _key: "testimonials-sentinel-key",
      name: "testimonials sentinel name",
      season: "testimonials sentinel season",
      quote: "testimonials sentinel quote",
    },
  ],
  howItWorks: {
    heading: "howItWorks sentinel heading",
    steps: [
      {
        _key: "howItWorks-sentinel-key",
        number: "01",
        title: "howItWorks sentinel title",
        body: "howItWorks sentinel body",
      },
    ],
  },
  dossier: {
    heading: "dossier sentinel heading",
    body: "dossier sentinel body",
    rows: [
      {
        _key: "dossier-sentinel-key",
        label: "dossier sentinel label",
        value: "dossier sentinel value",
      },
    ],
    image: { url: sentinelImage("dossier"), alt: "dossier sentinel alt" },
  },
  dailyPalette: {
    heading: "dailyPalette sentinel heading",
    body: "dailyPalette sentinel body",
    image: { url: sentinelImage("dailyPalette"), alt: "dailyPalette sentinel alt" },
    swatches: [
      { _key: "dailyPalette-sentinel-key", label: "dailyPalette sentinel swatch", hex: "#A1B2C3" },
    ],
  },
  concierge: {
    heading: "concierge sentinel heading",
    body: "concierge sentinel body",
    image: { url: sentinelImage("concierge"), alt: "concierge sentinel alt" },
    exchange: [
      { _key: "concierge-sentinel-key", role: "user", text: "concierge sentinel message" },
    ],
  },
  dupeHunter: {
    heading: "dupeHunter sentinel heading",
    body: "dupeHunter sentinel body",
    milaMatch: {
      label: "dupeHunter sentinel label",
      image: { url: sentinelImage("dupeHunter"), alt: "dupeHunter sentinel alt" },
    },
  },
  feed: {
    heading: "feed sentinel heading",
    body: "feed sentinel body",
    images: [{ _key: "feed-sentinel-key", url: sentinelImage("feed"), alt: "feed sentinel alt" }],
  },
  community: {
    heading: "community sentinel heading",
    body: "community sentinel body",
    seasonChips: ["community sentinel chip"],
  },
  pricing: { heading: "pricing sentinel heading", body: "pricing sentinel body" },
  finalCta: {
    heading: "finalCta sentinel heading",
    body: "finalCta sentinel body",
    privacyNote: "finalCta sentinel note",
    backgroundImage: { url: sentinelImage("finalCta"), alt: "finalCta sentinel alt" },
  },
};

type SentinelGroup = keyof typeof SENTINEL_DOC;
const SENTINEL_GROUPS = Object.keys(SENTINEL_DOC) as SentinelGroup[];

const sentinelsOf = (group: SentinelGroup) =>
  leafStrings(SENTINEL_DOC[group]).filter((value) => /sentinel/i.test(value));

/** `SENTINEL_DOC` with extra fields (a `hidden` flag, say) set on some groups. */
function sentinelDoc(flags: Partial<Record<SentinelGroup, Record<string, unknown>>>) {
  const doc: Record<string, unknown> = { ...SENTINEL_DOC };
  for (const group of Object.keys(flags) as SentinelGroup[]) {
    doc[group] = { ...SENTINEL_DOC[group], ...flags[group] };
  }
  return doc;
}

/**
 * The serialized content is what the browser receives. It must carry every
 * sentinel of every group except those of the `absent` groups, and none of theirs.
 */
function expectPayload(content: LandingContent, absent: SentinelGroup[]) {
  const payload = JSON.stringify(content);
  for (const group of SENTINEL_GROUPS) {
    for (const sentinel of sentinelsOf(group)) {
      expect([sentinel, payload.includes(sentinel)]).toEqual([sentinel, !absent.includes(group)]);
    }
  }
}

describe("normalizeLandingContent", () => {
  // LEGACY_DOCUMENT is what Sanity really returned, not a copy of the fallback,
  // so this fails when the checked-in copy and the published page drift apart.
  test("the real published document renders exactly the checked-in page", () => {
    expect(normalizeLandingContent(LEGACY_DOCUMENT, TARGET)).toEqual(LANDING_FALLBACK);
  });

  // An empty fixture would pass the test above (every field falls back), so
  // pin what the legacy document really carries: the groups that predate the Studio.
  test("the legacy fixture carries the eight groups published before the Studio", () => {
    const populated = Object.entries(LEGACY_DOCUMENT)
      .filter(([, group]) => group !== null)
      .map(([name]) => name);
    expect(populated.sort()).toEqual([
      "community",
      "dossier",
      "dupeHunter",
      "finalCta",
      "footer",
      "hero",
      "howItWorks",
      "testimonials",
    ]);
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
      { url: "https://evil.example/images/8bkzi9bn/production/abc123-1600x900.jpg", alt: "x" },
      { url: "javascript:alert(1)", alt: "x" },
      { url: "https://cdn.sanity.io/images/otherproj/production/abc123-1600x900.jpg", alt: "x" },
      { url: "https://cdn.sanity.io/images/8bkzi9bn/staging/abc123-1600x900.jpg", alt: "x" },
      { url: CDN, alt: "  " },
      { url: CDN },
    ]) {
      const out = normalizeLandingContent({ hero: { image } }, TARGET);
      expect(out.hero.image).toEqual(LANDING_FALLBACK.hero.image);
    }
  });

  /** The hero image a document with this image URL ends up with. */
  const heroImage = (url: unknown, target = TARGET) =>
    normalizeLandingContent({ hero: { image: { url, alt: "A style sheet" } } }, target).hero.image;

  test("image URLs: asset files of any size and format in this project are accepted", () => {
    for (const file of [
      "abc123-1600x900.jpg",
      "abc-800x600.jpg",
      "3f2a9c0b1d4e5f60718293a4b5c6d7e8f9012345-1686x1128.png",
      "AbC123-1x1.webp",
      "0-24x24.svg",
    ]) {
      const url = `${CDN_FOLDER}/${file}`;
      expect(heroImage(url)).toEqual({
        src: `${url}?auto=format&fit=max&w=1800`,
        alt: "A style sheet",
      });
    }
    const other = { projectId: "p1", dataset: "stage-2_b" };
    const url = "https://cdn.sanity.io/images/p1/stage-2_b/abc123-1600x900.jpg";
    expect(heroImage(url, other).src).toBe(`${url}?auto=format&fit=max&w=1800`);
  });

  test("image URLs: no path trick escapes this project's folder", () => {
    const escapes = {
      "dot-dot traversal": `${CDN_FOLDER}/../../otherproj/production/abc123-1600x900.jpg`,
      "percent-encoded traversal": `${CDN_FOLDER}/%2e%2e/%2e%2e/otherproj/production/abc123-1600x900.jpg`,
      "backslash traversal": `${CDN_FOLDER}/..\\..\\otherproj\\production\\abc123-1600x900.jpg`,
      "dot segment": `${CDN_FOLDER}/./abc123-1600x900.jpg`,
      "nested folder": `${CDN_FOLDER}/nested/abc123-1600x900.jpg`,
      "trailing slash": `${CDN}/`,
      "no dimensions": `${CDN_FOLDER}/abc123.jpg`,
      "no extension": `${CDN_FOLDER}/abc123-1600x900`,
      "uppercase extension": `${CDN_FOLDER}/abc123-1600x900.JPG`,
      "trailing parameters": `${CDN};w=1`,
      "percent-encoded character": `${CDN_FOLDER}/abc%31%32%33-1600x900.jpg`,
      "leading space": ` ${CDN}`,
      "trailing newline": `${CDN}\n`,
      "tab inside": `${CDN_FOLDER}/abc123\t-1600x900.jpg`,
      "NUL inside": `${CDN_FOLDER}/abc\u0000123-1600x900.jpg`,
      "DEL at the end": `${CDN}\u007f`,
    };
    for (const [name, url] of Object.entries(escapes)) {
      expect([name, heroImage(url)]).toEqual([name, LANDING_FALLBACK.hero.image]);
    }
  });

  test("image URLs: only https://cdn.sanity.io itself, with nothing added", () => {
    const path = "/images/8bkzi9bn/production/abc123-1600x900.jpg";
    const impostors = {
      "plain http": `http://cdn.sanity.io${path}`,
      "uppercase scheme and host": `HTTPS://CDN.SANITY.IO${path}`,
      "no slashes after the scheme": `https:cdn.sanity.io${path}`,
      "protocol-relative": `//cdn.sanity.io${path}`,
      "lookalike host": `https://cdn.sanity.io.evil.example${path}`,
      "host as username": `https://cdn.sanity.io@evil.example${path}`,
      "trailing-dot host": `https://cdn.sanity.io.${path}`,
      "username and password": `https://user:pw@cdn.sanity.io${path}`,
      "explicit port": `https://cdn.sanity.io:8443${path}`,
      "default port": `https://cdn.sanity.io:443${path}`,
      "query string": `${CDN}?w=10`,
      "bare question mark": `${CDN}?`,
      fragment: `${CDN}#x`,
      "bare hash": `${CDN}#`,
      "not a string": 42,
    };
    for (const [name, url] of Object.entries(impostors)) {
      expect([name, heroImage(url)]).toEqual([name, LANDING_FALLBACK.hero.image]);
    }
  });

  test("image URLs: the project id and dataset are matched literally", () => {
    expect(heroImage(CDN, { projectId: "8bkzi9b.", dataset: "production" })).toEqual(
      LANDING_FALLBACK.hero.image,
    );
    expect(heroImage(CDN, { projectId: "8bkzi9bn", dataset: "prod.*" })).toEqual(
      LANDING_FALLBACK.hero.image,
    );
    expect(
      heroImage("https://cdn.sanity.io/images///abc123-1600x900.jpg", {
        projectId: "",
        dataset: "",
      }),
    ).toEqual(LANDING_FALLBACK.hero.image);
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

  test("fields that no component renders never reach the page", () => {
    const out = normalizeLandingContent(
      {
        hero: {
          kicker: "Rendered kicker",
          preview: {
            season: "Soft Autumn",
            weather: "12°C · Clear",
            outfitTitle: "UNRENDERED",
            outfitBody: "UNRENDERED",
            hair: "UNRENDERED",
            makeup: "UNRENDERED",
          },
        },
        howItWorks: { kicker: "UNRENDERED" },
        dossier: { kicker: "UNRENDERED" },
        dupeHunter: { kicker: "UNRENDERED" },
        community: { kicker: "UNRENDERED" },
      },
      TARGET,
    );
    expect(leafStrings(out)).not.toContain("UNRENDERED");
    expect(out.hero.kicker).toBe("Rendered kicker");
    expect(out.hero.preview).toEqual({ season: "Soft Autumn", weather: "12°C · Clear" });
  });

  test("the checked-in copy carries no field that nothing renders", () => {
    expect(LANDING_FALLBACK.hero.preview).toEqual({
      season: "True Summer",
      weather: "18°C · Light rain",
    });
    for (const group of ["howItWorks", "dossier", "dupeHunter", "community"] as const) {
      expect([group, Object.keys(LANDING_FALLBACK[group]).includes("kicker")]).toEqual([
        group,
        false,
      ]);
    }
    expect(LANDING_FALLBACK.hero.kicker).toBe("Your AI stylist");
  });
});

// Loader data is serialized into the page for hydration, so whatever the
// content carries is readable in the page source, rendered or not.
describe("normalizeLandingContent: hidden content is not sent to the browser", () => {
  test("with nothing hidden, every group's copy is sent", () => {
    expect(SENTINEL_GROUPS.map((group) => sentinelsOf(group).length)).toEqual([
      1, 4, 4, 7, 6, 6, 5, 5, 3, 2, 5,
    ]);
    expectPayload(normalizeLandingContent(SENTINEL_DOC, TARGET), []);
  });

  test("hidden testimonials are dropped; the community copy stays", () => {
    const out = normalizeLandingContent(
      sentinelDoc({ community: { hideTestimonials: true } }),
      TARGET,
    );
    expect(out.testimonials).toEqual([]);
    expect(out.community.hideTestimonials).toBe(true);
    expectPayload(out, ["testimonials"]);
  });

  test("a hidden section that only the home page renders is sent without its copy", () => {
    const blank = {
      dailyPalette: {
        hidden: true,
        heading: "",
        body: "",
        image: { src: "", alt: "" },
        swatches: [],
      },
      concierge: {
        hidden: true,
        heading: "",
        body: "",
        image: { src: "", alt: "" },
        exchange: [],
      },
      feed: { hidden: true, heading: "", body: "", images: [] },
      finalCta: {
        hidden: true,
        heading: "",
        body: "",
        privacyNote: "",
        backgroundImage: { src: "", alt: "" },
      },
    };
    for (const group of ["dailyPalette", "concierge", "feed", "finalCta"] as const) {
      const out = normalizeLandingContent(sentinelDoc({ [group]: { hidden: true } }), TARGET);
      expect([group, out[group]]).toEqual([group, blank[group]]);
      expectPayload(out, [group]);
    }
  });

  test("a hidden section that has its own page keeps its copy", () => {
    for (const group of ["howItWorks", "dossier", "dupeHunter", "community", "pricing"] as const) {
      const out = normalizeLandingContent(sentinelDoc({ [group]: { hidden: true } }), TARGET);
      expect([group, out[group].hidden]).toEqual([group, true]);
      expectPayload(out, []);
    }
  });

  test("blanked sections never share their placeholders with one another", () => {
    const out = normalizeLandingContent(
      sentinelDoc({ dailyPalette: { hidden: true }, concierge: { hidden: true } }),
      TARGET,
    );
    out.dailyPalette.image.src = "changed";
    expect(out.concierge.image.src).toBe("");
    expect(
      normalizeLandingContent(sentinelDoc({ dailyPalette: { hidden: true } }), TARGET).dailyPalette
        .image.src,
    ).toBe("");
  });
});

describe("LANDING_QUERY", () => {
  test("projects every content group the page renders, by the singleton id", () => {
    expect(LANDING_QUERY).toContain('*[_id == "landingPage" && defined(howItWorks)][0]');
    // The groups projected at the top level (`  name{` or `  name[]{`). A
    // substring check is not enough: "cta" is also found inside "ctaNote".
    const projected = [...LANDING_QUERY.matchAll(/^ {2}(\w+)(?:\[\])?\{/gm)].map(
      (match) => match[1],
    );
    expect(projected.sort()).toEqual(Object.keys(LANDING_FALLBACK).sort());
    expect(LANDING_QUERY).toContain("asset->url");
  });

  test("asks Sanity for no field that nothing renders", () => {
    for (const field of ["outfitTitle", "outfitBody", "hair", "makeup"]) {
      expect(LANDING_QUERY).not.toContain(field);
    }
    expect(LANDING_QUERY).toContain("preview{season, weather}");
    // Only the hero's kicker is rendered.
    expect(LANDING_QUERY.match(/\bkicker\b/g)).toEqual(["kicker"]);
    expect(LANDING_QUERY).toContain("hero{\n    kicker,");
  });
});

describe("createLandingLoader", () => {
  test("a fetch error gives the fallback and a server-side warning without secrets", async () => {
    const warnings: unknown[][] = [];
    const out = await createLandingLoader(fakeClock())({
      fetchDocument: async () => {
        throw new Error("401 token=sk-secret-value");
      },
      target: TARGET,
      warn: (...args) => warnings.push(args),
      report: () => {},
    });
    expect(out).toEqual(LANDING_FALLBACK);
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain("sk-secret-value");
  });

  test("an unpublished document gives the fallback and a warning", async () => {
    const warnings: unknown[][] = [];
    const out = await createLandingLoader(fakeClock())({
      fetchDocument: async () => null,
      target: TARGET,
      warn: (...args) => warnings.push(args),
      report: () => {},
    });
    expect(out).toEqual(LANDING_FALLBACK);
    expect(warnings).toHaveLength(1);
  });

  test("missing Sanity configuration gives the fallback without a read or a throw", async () => {
    const warnings: unknown[][] = [];
    let fetches = 0;
    const out = await createLandingLoader(fakeClock())({
      fetchDocument: async () => {
        fetches += 1;
        return milaDoc({ hero: { kicker: "Must not be read" } });
      },
      target: null,
      warn: (...args) => warnings.push(args),
      report: () => {},
    });
    expect(out).toEqual(LANDING_FALLBACK);
    expect(fetches).toBe(0);
    expect(warnings).toHaveLength(1);
  });

  test("a published document is normalized", async () => {
    const out = await createLandingLoader(fakeClock())({
      fetchDocument: async () => milaDoc({ hero: { kicker: "New kicker" } }),
      target: TARGET,
      warn: () => {},
      report: () => {},
    });
    expect(out.hero.kicker).toBe("New kicker");
  });

  test("a read that never settles gives the fallback after 4 seconds and is cancelled", async () => {
    const clock = fakeClock();
    let signal: AbortSignal | undefined;
    let out: LandingContent | undefined;
    void createLandingLoader(clock)({
      fetchDocument: (requestSignal) => {
        signal = requestSignal;
        return new Promise(() => {});
      },
      target: TARGET,
      warn: () => {},
      report: () => {},
    }).then((content) => {
      out = content;
    });

    clock.advance(3_999);
    await settle();
    expect(out).toBeUndefined();
    expect(signal?.aborted).toBe(false);

    clock.advance(1);
    await settle();
    expect(out).toEqual(LANDING_FALLBACK);
    expect(signal?.aborted).toBe(true);
  });

  test("a read that settles in time leaves no deadline timer and is never aborted", async () => {
    for (const fetchDocument of [
      async () => milaDoc({ hero: { kicker: "New kicker" } }),
      async () => {
        throw new Error("boom");
      },
    ]) {
      const clock = fakeClock();
      let signal: AbortSignal | undefined;
      await createLandingLoader(clock)({
        fetchDocument: (requestSignal) => {
          signal = requestSignal;
          return fetchDocument();
        },
        target: TARGET,
        warn: () => {},
        report: () => {},
      });
      expect(clock.pending()).toBe(0);
      clock.advance(60_000);
      expect(signal?.aborted).toBe(false);
    }
  });

  test("without an injected clock a read that takes real time is still served", async () => {
    const warnings: unknown[][] = [];
    const out = await createLandingLoader()({
      fetchDocument: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(milaDoc({ hero: { kicker: "New kicker" } })), 5),
        ),
      target: TARGET,
      warn: (...args) => warnings.push(args),
      report: () => {},
    });
    expect(out.hero.kicker).toBe("New kicker");
    expect(warnings).toEqual([]);
  });
});

describe("createLandingLoader: a failed read keeps the editors' work", () => {
  test("after a good read, a failure serves that content with its hidden sections", async () => {
    const loader = scriptedLoader();
    const good = await loader.load();
    expect(good.howItWorks.hidden).toBe(true);

    loader.nextRead(failWith(new Error("Sanity is down")));
    const served = await loader.load();
    expect(served.hero.headlineLine1).toBe("Dressed by noon.");
    expect(served.howItWorks).toEqual({
      ...LANDING_FALLBACK.howItWorks,
      hidden: true,
      heading: "Three steps",
    });
    expect(served.feed.hidden).toBe(true);
    expect(served).toEqual(good);
  });

  test("every kind of failure serves the last good content", async () => {
    const failures: Record<string, (signal: AbortSignal) => Promise<unknown>> = {
      "a thrown error": failWith(new Error("boom")),
      "a thrown non-error": failWith("boom"),
      "an unpublished document": async () => null,
      "a string instead of a document": async () => "oops",
      "a list instead of a document": async () => [EDITED_DOC],
      "a read that never settles": () => new Promise(() => {}),
    };
    for (const [name, failure] of Object.entries(failures)) {
      const loader = scriptedLoader();
      await loader.load();
      loader.nextRead(failure);
      const pending = loader.load();
      await settle();
      loader.clock.advance(4_000);
      const served = await pending;
      expect([name, served.hero.headlineLine1]).toEqual([name, "Dressed by noon."]);
      expect([name, served.feed.hidden]).toEqual([name, true]);
    }
  });

  test("content already served cannot be changed through a copy a caller holds", async () => {
    const loader = scriptedLoader();
    const first = await loader.load();
    first.hero.headlineLine1 = "mutated by a caller";
    first.testimonials.length = 0;

    loader.nextRead(failWith(new Error("boom")));
    const served = await loader.load();
    expect(served.hero.headlineLine1).toBe("Dressed by noon.");
    expect(served.testimonials).toHaveLength(5);

    served.hero.headlineLine1 = "mutated again";
    expect((await loader.load()).hero.headlineLine1).toBe("Dressed by noon.");
  });

  test("hidden content stays out of the payload, fresh and from the last good copy", async () => {
    const loader = scriptedLoader();
    loader.nextRead(async () =>
      sentinelDoc({
        feed: { hidden: true },
        dossier: { hidden: true },
        community: { hideTestimonials: true },
      }),
    );
    const fresh = await loader.load();
    expect(fresh.dossier.hidden).toBe(true);
    expectPayload(fresh, ["feed", "testimonials"]);

    loader.nextRead(failWith(new Error("Sanity is down")));
    const served = await loader.load();
    expect(loader.seen.warnings).toHaveLength(1);
    expect(served.dossier.hidden).toBe(true);
    expectPayload(served, ["feed", "testimonials"]);
  });
});

describe("createLandingLoader: after a failure Sanity is left alone for 30 seconds", () => {
  test("a call inside the 30 seconds does not read Sanity and serves the last good content", async () => {
    const loader = scriptedLoader();
    await loader.load();
    loader.nextRead(failWith(new Error("boom")));
    await loader.load();
    expect(loader.seen.fetches).toBe(2);

    loader.nextRead(async () => milaDoc({ hero: { headlineLine1: "Fresh, but too soon." } }));
    loader.clock.advance(29_999);
    const served = await loader.load();
    expect(loader.seen.fetches).toBe(2);
    expect(served.hero.headlineLine1).toBe("Dressed by noon.");
    expect(served.feed.hidden).toBe(true);
  });

  test("with no history, a call inside the 30 seconds serves the checked-in copy unread", async () => {
    const loader = scriptedLoader();
    loader.nextRead(failWith(new Error("boom")));
    await loader.load();
    loader.clock.advance(1);
    expect(await loader.load()).toEqual(LANDING_FALLBACK);
    expect(loader.seen.fetches).toBe(1);
  });

  test("a call 30 seconds after the failure reads Sanity again", async () => {
    const loader = scriptedLoader();
    loader.nextRead(failWith(new Error("boom")));
    await loader.load();

    loader.nextRead(async () => milaDoc({ hero: { headlineLine1: "Back online." } }));
    loader.clock.advance(30_000);
    const served = await loader.load();
    expect(loader.seen.fetches).toBe(2);
    expect(served.hero.headlineLine1).toBe("Back online.");
  });

  test("a second failure starts a new 30 seconds", async () => {
    const loader = scriptedLoader();
    loader.nextRead(failWith(new Error("boom")));
    await loader.load();
    loader.clock.advance(30_000);
    await loader.load();
    expect(loader.seen.fetches).toBe(2);

    loader.clock.advance(29_999);
    await loader.load();
    expect(loader.seen.fetches).toBe(2);
    loader.clock.advance(1);
    await loader.load();
    expect(loader.seen.fetches).toBe(3);
  });

  test("a good read is not followed by a quiet period", async () => {
    const loader = scriptedLoader();
    await loader.load();
    await loader.load();
    expect(loader.seen.fetches).toBe(2);
  });
});

describe("createLandingLoader: only MILA's document is accepted", () => {
  test("another product's document is refused: none of its text reaches the page", async () => {
    const loader = scriptedLoader();
    loader.nextRead(async () => LINARA_DOC);
    const out = await loader.load();

    const served = leafStrings(out);
    expect(leafStrings(LINARA_DOC)).toHaveLength(9);
    for (const foreign of leafStrings(LINARA_DOC)) {
      expect(served).not.toContain(foreign);
    }
    expect(out).toEqual(LANDING_FALLBACK);
  });

  test("a refused document warns that it does not look like MILA's and is reported", async () => {
    const loader = scriptedLoader();
    loader.nextRead(async () => LINARA_DOC);
    await loader.load();
    expect(loader.seen.warnings).toHaveLength(1);
    expect(loader.seen.warnings[0]).toContain("does not look like MILA's");
    expect(loader.seen.warnings[0]).toContain("8bkzi9bn/production");
    expect(loader.seen.reports).toHaveLength(1);
    expect((loader.seen.reports[0] as Error).name).toBe("LandingDocumentError");
  });

  test("a refused document is a failure: last good content, then 30 quiet seconds", async () => {
    const loader = scriptedLoader();
    await loader.load();
    loader.nextRead(async () => LINARA_DOC);
    const served = await loader.load();
    expect(served.hero.headlineLine1).toBe("Dressed by noon.");
    expect(served.seo.title).toBe("Mila — Your stylist. Every morning.");

    loader.clock.advance(29_999);
    await loader.load();
    expect(loader.seen.fetches).toBe(2);
  });

  test("howItWorks must be an object; an empty one is enough", async () => {
    for (const howItWorks of [undefined, null, "How it works", 42, ["steps"]]) {
      const loader = scriptedLoader();
      loader.nextRead(async () => ({ howItWorks, hero: { headlineLine1: "Not MILA." } }));
      const out = await loader.load();
      expect([howItWorks, out.hero.headlineLine1]).toEqual([howItWorks, "Your stylist."]);
      expect(loader.seen.warnings).toHaveLength(1);
    }

    const loader = scriptedLoader();
    loader.nextRead(async () => ({ howItWorks: {}, hero: { headlineLine1: "MILA." } }));
    expect((await loader.load()).hero.headlineLine1).toBe("MILA.");
    expect(loader.seen.warnings).toEqual([]);
  });
});

describe("createLandingLoader: a failed read is visible to the owner", () => {
  test("each real failure warns once and is reported once; skipped calls add nothing", async () => {
    const loader = scriptedLoader();
    const first = new Error("first");
    const second = new Error("second");

    loader.nextRead(failWith(first));
    await loader.load();
    expect(loader.seen.reports).toHaveLength(1);
    expect(loader.seen.reports[0]).toBe(first);
    expect(loader.seen.warnings).toHaveLength(1);

    loader.clock.advance(10_000);
    await loader.load();
    await loader.load();
    expect(loader.seen.reports).toHaveLength(1);
    expect(loader.seen.warnings).toHaveLength(1);

    loader.nextRead(failWith(second));
    loader.clock.advance(20_000);
    await loader.load();
    expect(loader.seen.reports).toHaveLength(2);
    expect(loader.seen.reports[1]).toBe(second);
    expect(loader.seen.warnings).toHaveLength(2);
  });

  test("reads already under way when an outage starts fail quietly: one warning, one report, 30 seconds from the first failure", async () => {
    const loader = scriptedLoader();
    const rejects: ((error: unknown) => void)[] = [];
    loader.nextRead(() => new Promise((_, reject) => rejects.push(reject)));
    const reads = [loader.load(), loader.load(), loader.load()];
    await settle();
    expect(loader.seen.fetches).toBe(3);

    const first = new Error("first");
    loader.clock.advance(1_000);
    rejects[0](first);
    await settle();
    loader.clock.advance(1_000);
    rejects[1](new Error("second"));
    await settle();
    loader.clock.advance(1_000);
    rejects[2](new Error("third"));

    for (const served of await Promise.all(reads)) {
      expect(served).toEqual(LANDING_FALLBACK);
    }
    expect(loader.seen.warnings).toHaveLength(1);
    expect(loader.seen.reports).toHaveLength(1);
    expect(loader.seen.reports[0]).toBe(first);

    // The first failure was at 1s, the last at 3s: quiet until 31s, not 33s.
    loader.nextRead(async () => milaDoc({ hero: { headlineLine1: "Back online." } }));
    loader.clock.advance(27_999);
    await loader.load();
    expect(loader.seen.fetches).toBe(3);
    loader.clock.advance(1);
    expect((await loader.load()).hero.headlineLine1).toBe("Back online.");
    expect(loader.seen.fetches).toBe(4);
  });

  test("a good read warns about nothing and reports nothing", async () => {
    const loader = scriptedLoader();
    await loader.load();
    expect(loader.seen.reports).toEqual([]);
    expect(loader.seen.warnings).toEqual([]);
  });

  test("the warning names project, dataset, error name and HTTP status, never the upstream message", async () => {
    const loader = scriptedLoader();
    loader.nextRead(
      failWith(
        Object.assign(new RangeError("upstream said token=sk-secret-value"), { statusCode: 503 }),
      ),
    );
    await loader.load();
    const [warning] = loader.seen.warnings;
    expect(warning).toContain("8bkzi9bn/production");
    expect(warning).toContain("RangeError");
    expect(warning).toContain("HTTP 503");
    expect(warning).not.toContain("sk-secret-value");

    const plain = scriptedLoader();
    plain.nextRead(failWith(new TypeError("fetch failed")));
    await plain.load();
    expect(plain.seen.warnings[0]).toContain("TypeError");
    expect(plain.seen.warnings[0]).not.toContain("HTTP");
  });

  test("a timeout is reported as a timeout, even when the cancelled read then rejects", async () => {
    const loader = scriptedLoader();
    loader.nextRead(
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    const pending = loader.load();
    await settle();
    loader.clock.advance(4_000);
    await pending;
    await settle();
    expect(loader.seen.reports).toHaveLength(1);
    expect((loader.seen.reports[0] as Error).name).toBe("LandingTimeoutError");
    expect(loader.seen.warnings).toHaveLength(1);
    expect(loader.seen.warnings[0]).toContain("LandingTimeoutError");
  });

  test("an unpublished document is reported and the warning says so", async () => {
    const loader = scriptedLoader();
    loader.nextRead(async () => null);
    await loader.load();
    expect(loader.seen.reports).toHaveLength(1);
    expect((loader.seen.reports[0] as Error).name).toBe("LandingDocumentError");
    expect(loader.seen.warnings[0]).toContain('no published "landingPage" document');
    expect(loader.seen.warnings[0]).toContain("8bkzi9bn/production");
  });

  test("a reporter that itself throws does not take the page down", async () => {
    const out = await createLandingLoader(fakeClock())({
      fetchDocument: failWith(new Error("boom")),
      target: TARGET,
      warn: () => {},
      report: () => {
        throw new Error("Sentry transport exploded");
      },
    });
    expect(out).toEqual(LANDING_FALLBACK);
  });
});
