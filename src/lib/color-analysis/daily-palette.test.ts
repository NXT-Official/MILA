import { describe, expect, test } from "bun:test";
import { chroma, lightness } from "./colour-math";
import {
  WEAR_LINES,
  buildDailyPalette,
  localDateKey,
  paletteForKey,
  paletteSeed,
  pushRecent,
  trioKey,
} from "./daily-palette";

// Golden vectors, copied verbatim by mobile.
const SWATCHES = [
  { name: "Saddle Brown", hex: "#8B4513" },
  { name: "Camel", hex: "#C19A6B" },
  { name: "Olive", hex: "#556B2F" },
  { name: "Rust", hex: "#B7410E" },
  { name: "Mustard", hex: "#FFDB58" },
  { name: "Charcoal", hex: "#36454F" },
];

const GOLDEN_SEED = paletteSeed("member-1", "2026-10-07", 0);

describe("daily palette", () => {
  test("a trio of three different swatches of hers", () => {
    const palette = buildDailyPalette({ swatches: SWATCHES, seed: GOLDEN_SEED, recent: [] });
    expect(palette).not.toBeNull();
    const hexes = [palette!.baseHex, palette!.statementHex, palette!.accentHex];
    expect(new Set(hexes).size).toBe(3);
    for (const hex of hexes) expect(SWATCHES.map((s) => s.hex)).toContain(hex);
    expect(palette!.source).toBe("swatches");
    expect(palette!.isSisterSeasonIncluded).toBe(false);
  });

  test("base is the deepest, statement the most vivid of the other two", () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const p = buildDailyPalette({
        swatches: SWATCHES,
        seed: paletteSeed("member-1", "2026-10-07", attempt),
        recent: [],
      })!;
      const l = (hex: string) => lightness(hex)!;
      const c = (hex: string) => chroma(hex)!;
      expect(l(p.baseHex)).toBeLessThanOrEqual(l(p.statementHex));
      expect(l(p.baseHex)).toBeLessThanOrEqual(l(p.accentHex));
      expect(c(p.statementHex)).toBeGreaterThanOrEqual(c(p.accentHex));
    }
  });

  test("same member, day and attempt give the same palette", () => {
    const a = buildDailyPalette({ swatches: SWATCHES, seed: GOLDEN_SEED, recent: [] });
    const b = buildDailyPalette({ swatches: SWATCHES, seed: GOLDEN_SEED, recent: [] });
    expect(a).toEqual(b);
    expect(GOLDEN_SEED).toBe("member-1:2026-10-07:0");
    // Golden vectors, copied verbatim by mobile: [member, day, attempt, base, statement, accent].
    const golden = [
      ["member-1", "2026-10-07", 0, "Charcoal", "Rust", "Camel"],
      ["member-1", "2026-10-07", 1, "Charcoal", "Saddle Brown", "Olive"],
      ["member-2", "2026-10-08", 0, "Olive", "Rust", "Mustard"],
    ] as const;
    for (const [user, day, attempt, base, statement, accent] of golden) {
      const p = buildDailyPalette({
        swatches: SWATCHES,
        seed: paletteSeed(user, day, attempt),
        recent: [],
      })!;
      expect([p.baseColor, p.statementColor, p.accentColor]).toEqual([base, statement, accent]);
    }
  });

  test("Shuffle never returns one of the last five trios", () => {
    let recent: string[] = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const p = buildDailyPalette({
        swatches: SWATCHES,
        seed: paletteSeed("member-1", "2026-10-07", attempt),
        recent,
      })!;
      const key = trioKey([p.baseHex, p.statementHex, p.accentHex]);
      expect(recent).not.toContain(key);
      recent = pushRecent(recent, key, 5);
    }
  });

  test("when every trio was recent, the oldest one comes back rather than nothing", () => {
    const three = SWATCHES.slice(0, 3);
    const only = trioKey(three.map((s) => s.hex));
    const p = buildDailyPalette({ swatches: three, seed: GOLDEN_SEED, recent: [only] });
    expect(p).not.toBeNull();
    expect(trioKey([p!.baseHex, p!.statementHex, p!.accentHex])).toBe(only);
  });

  test("fewer than three swatches returns null", () => {
    expect(buildDailyPalette({ swatches: [], seed: GOLDEN_SEED, recent: [] })).toBeNull();
    expect(
      buildDailyPalette({ swatches: SWATCHES.slice(0, 2), seed: GOLDEN_SEED, recent: [] }),
    ).toBeNull();
  });

  test("the insight names all three colors and places, with no dashes", () => {
    const p = buildDailyPalette({ swatches: SWATCHES, seed: GOLDEN_SEED, recent: [] })!;
    expect(p.insight).toBe(
      `Wear ${p.baseColor} on your bottoms or a jacket, ${p.statementColor} on top near your face, and ${p.accentColor} on your shoes, bag or jewelry.`,
    );
    expect(p.insight).not.toMatch(/[–—]/);
    expect(WEAR_LINES.base).toBe("Bottoms or a jacket");
    expect(WEAR_LINES.statement).toBe("Top, near your face");
    expect(WEAR_LINES.accent).toBe("Shoes, bag or jewelry");
  });

  test("trioKey ignores order; pushRecent keeps the last N without repeats", () => {
    expect(trioKey(["#AAAAAA", "#bbbbbb", "#CCCCCC"])).toBe(
      trioKey(["#cccccc", "#AAAAAA", "#BBBBBB"]),
    );
    expect(pushRecent(["a", "b", "c", "d", "e"], "f", 5)).toEqual(["b", "c", "d", "e", "f"]);
    expect(pushRecent(["a", "b", "c"], "a", 5)).toEqual(["b", "c", "a"]);
  });

  test("paletteForKey rebuilds the trio that was shown, or null when it is no longer hers", () => {
    const p = buildDailyPalette({ swatches: SWATCHES, seed: GOLDEN_SEED, recent: [] })!;
    const key = trioKey([p.baseHex, p.statementHex, p.accentHex]);
    expect(paletteForKey({ swatches: SWATCHES, key })).toEqual(p);
    expect(paletteForKey({ swatches: SWATCHES.slice(0, 3), key: "x|y|z" })).toBeNull();
  });

  test("localDateKey is the local calendar day", () => {
    expect(localDateKey(new Date(2026, 9, 7, 23, 59))).toBe("2026-10-07");
    expect(localDateKey(new Date(2026, 0, 2, 0, 1))).toBe("2026-01-02");
  });
});

describe("daily palette: swatches it is given", () => {
  test("invalid hex values are ignored, not trusted to upstream filtering", () => {
    const messy = [
      { name: "Broken", hex: "#nothex" },
      { name: "Short", hex: "#FFF" },
      ...SWATCHES.slice(0, 2),
    ];
    expect(buildDailyPalette({ swatches: messy, seed: GOLDEN_SEED, recent: [] })).toBeNull();
    const three = buildDailyPalette({
      swatches: [...messy, SWATCHES[2]!],
      seed: GOLDEN_SEED,
      recent: [],
    })!;
    expect(new Set([three.baseHex, three.statementHex, three.accentHex])).toEqual(
      new Set(SWATCHES.slice(0, 3).map((s) => s.hex)),
    );
  });

  test("a repeated hex counts once, in either case, so a trio is never two copies of one colour", () => {
    const dupes = [
      SWATCHES[0]!,
      { name: "Saddle Again", hex: "#8b4513" },
      SWATCHES[1]!,
      { name: "Camel Twin", hex: "#C19A6B" },
    ];
    expect(buildDailyPalette({ swatches: dupes, seed: GOLDEN_SEED, recent: [] })).toBeNull();
    const p = buildDailyPalette({
      swatches: [...dupes, SWATCHES[2]!],
      seed: GOLDEN_SEED,
      recent: [],
    })!;
    expect(new Set([p.baseHex, p.statementHex, p.accentHex].map((h) => h.toUpperCase())).size).toBe(
      3,
    );
    expect(
      paletteForKey({ swatches: dupes, key: trioKey(SWATCHES.slice(0, 3).map((s) => s.hex)) }),
    ).toBeNull();
  });
});
