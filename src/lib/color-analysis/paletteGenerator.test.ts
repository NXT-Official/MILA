import { describe, expect, test } from "bun:test";
import { generateDailyPalette, type DailyPalette } from "./paletteGenerator";

const DRAWS = 400;

/** Evenly spaced stand-ins for Math.random, so every index of a short list gets hit. */
function sweep(i: number): () => number {
  return () => (i % 64) / 64;
}

function draws(season: string | null, previous: DailyPalette | null = null): DailyPalette[] {
  return Array.from({ length: DRAWS }, (_, i) => generateDailyPalette(season, previous, sweep(i)));
}

function bases(season: string | null): Set<string> {
  return new Set(draws(season).map((p) => p.baseColor));
}

const SUITED_BASES: Record<string, string[]> = {
  Spring: ["Warm Peach Blush", "Sage Mist", "Champagne"],
  Summer: ["Lavender Cream", "Charcoal"],
  Autumn: ["Warm Peach Blush", "Sage Mist", "Champagne", "Warm Olive"],
  Winter: ["Charcoal", "Midnight Navy", "Deep Emerald"],
};

describe("generateDailyPalette season matching", () => {
  for (const [family, suited] of Object.entries(SUITED_BASES)) {
    test(`${family} members only get mixes that suit ${family}`, () => {
      const seen = bases(family);
      for (const base of seen) expect(suited).toContain(base);
    });

    test(`${family} members have more than one mix to shuffle between`, () => {
      expect(bases(family).size).toBeGreaterThan(1);
    });
  }

  test("a Winter member is never handed the warm peach mix", () => {
    expect(bases("Winter").has("Warm Peach Blush")).toBe(false);
  });

  test("reads the season strings the app actually stores", () => {
    const stored: Array<[string, string]> = [
      ["Winter Deep / Dark Winter", "Winter"],
      ["Spring Light / PCCS Light & Soft", "Spring"],
      ["Summer Muted / Soft Summer", "Summer"],
      ["Autumn Soft / Hazy Earth", "Autumn"],
      ["Soft Autumn", "Autumn"],
      ["Bright Winter", "Winter"],
      ["cool_summer", "Summer"],
      ["Spring · Studio Tuned", "Spring"],
      ["winter", "Winter"],
      ["  Fall  ", "Autumn"],
    ];
    for (const [value, family] of stored) {
      for (const base of bases(value)) expect(SUITED_BASES[family]).toContain(base);
    }
  });

  test("a matched palette says it was picked for the member's season", () => {
    for (const p of draws("Soft Autumn")) expect(p.insight).toContain("Autumn");
  });
});

describe("generateDailyPalette without a usable season", () => {
  for (const season of [null, "", "   ", "Rainbow"]) {
    test(`falls back to the full set for ${JSON.stringify(season)}`, () => {
      const seen = bases(season);
      expect(seen.size).toBeGreaterThanOrEqual(5);
      expect(seen.has("Warm Peach Blush")).toBe(true);
      expect(seen.has("Charcoal")).toBe(true);
    });

    test(`never claims the mix came from the member's palette for ${JSON.stringify(season)}`, () => {
      for (const p of draws(season)) {
        expect(p.insight).not.toMatch(/your (palette|season|colou?rs?)/i);
        expect(p.insight).not.toMatch(/picked for/i);
      }
    });
  }
});

describe("generateDailyPalette shuffling", () => {
  test("a shuffle never repeats the current mix while another suits the member", () => {
    for (const season of ["Spring", "Summer", "Autumn", "Winter", null]) {
      let current = generateDailyPalette(season, null, sweep(0));
      for (let i = 0; i < DRAWS; i++) {
        const next = generateDailyPalette(season, current, sweep(i));
        expect(next.baseHex).not.toBe(current.baseHex);
        current = next;
      }
    }
  });

  test("the same random draw gives the same mix, with no hidden state between calls", () => {
    const first = generateDailyPalette("Winter", null, () => 0.1);
    const second = generateDailyPalette("Winter", null, () => 0.1);
    expect(second).toEqual(first);
  });

  test("returns the DailyPalette shape the saved-palettes store expects", () => {
    const p = generateDailyPalette("Winter", null, () => 0.5);
    for (const hex of [p.baseHex, p.statementHex, p.accentHex]) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
    }
    for (const field of [p.baseColor, p.statementColor, p.accentColor, p.styleVibe, p.insight]) {
      expect(field.length).toBeGreaterThan(0);
    }
    expect(p.isSisterSeasonIncluded).toBe(false);
  });
});
