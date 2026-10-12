import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LANDING_FALLBACK } from "./landing-content.fallback";

/** Every string in the checked-in landing copy, with the path it sits at. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, i) => strings(item, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      strings(child, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

const COPY = strings(LANDING_FALLBACK).filter(([path]) => !path.endsWith("._key"));

function words(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

describe("the checked-in landing copy speaks one locale", () => {
  test("no em or en dash anywhere, alt text included", () => {
    expect(COPY.filter(([, text]) => /[–—]/.test(text))).toEqual([]);
  });

  test("US spelling throughout", () => {
    const british = /\b(colour|colours|personalised|personalise|favourite|grey|jewellery)\b/i;
    expect(COPY.filter(([, text]) => british.test(text))).toEqual([]);
  });

  test("prices are in dollars and temperatures in Fahrenheit", () => {
    expect(COPY.filter(([, text]) => /[£€]|°C/.test(text))).toEqual([]);
    const dupe = LANDING_FALLBACK.dupeHunter;
    expect(dupe.inspiration.price).toMatch(/^\$\d/);
    expect(dupe.milaMatch.price).toMatch(/^\$\d/);
    expect(dupe.heading).toMatch(/\$\d/);
  });
});

describe("the checked-in landing copy promises only what ships", () => {
  test("the feed is neither filtered by season nor unlocked by posting", () => {
    const claims = /unlock|only the looks|share your palette/i;
    expect(COPY.filter(([, text]) => claims.test(text))).toEqual([]);
  });

  test("onboarding is not sold as three questions under a minute", () => {
    const claims = /three (quick )?questions|under a minute/i;
    expect(COPY.filter(([, text]) => claims.test(text))).toEqual([]);
  });

  test("nothing promises a free look: a member without a plan has no styling credits", () => {
    // DEFAULT_AI_CREDITS is 0 and composing a look always costs a credit; the
    // once-ever color read is what is free. Granting a first look is the owner's call.
    expect(COPY.filter(([, text]) => /first look/i.test(text))).toEqual([]);
  });

  test("no credit packs: none are on sale", () => {
    expect(COPY.filter(([, text]) => /credit pack|top up/i.test(text))).toEqual([]);
  });

  test("the hero sub-copy, its closing line included, is 20 words or fewer", () => {
    const { subhead, ctaNote } = LANDING_FALLBACK.hero;
    expect(words(`${subhead} ${ctaNote}`)).toBeLessThanOrEqual(20);
  });
});

describe("the checked-in landing images", () => {
  test("every image is a file in public/", () => {
    const sources = COPY.filter(([path]) => path.endsWith(".src")).map(([, src]) => src);
    // Guard: the walk found the images.
    expect(sources.length).toBeGreaterThan(5);
    const missing = sources.filter(
      (src) => !existsSync(join(import.meta.dir, "..", "..", "public", src)),
    );
    expect(missing).toEqual([]);
  });

  test("the dupe inspiration and the match are visibly different photos", () => {
    const { inspiration, milaMatch } = LANDING_FALLBACK.dupeHunter;
    expect(inspiration.image.src).not.toBe(milaMatch.image.src);
    // These two files show the same coat on two near-identical models.
    const lookAlikes = ["/landing/dupe-inspiration.jpg", "/landing/dupe-match.jpg"];
    expect(
      lookAlikes.includes(inspiration.image.src) && lookAlikes.includes(milaMatch.image.src),
    ).toBe(false);
  });
});
