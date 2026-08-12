import { expect, test } from "bun:test";
import { buildOutfitCombos, luminance } from "./outfit-combos";
import type { DetailedColorProfile } from "@/constants/style-profile";

const s = (hex: string, name: string) => ({ hex, name });

function profile(over: Partial<DetailedColorProfile> = {}): DetailedColorProfile {
  return {
    primarySwatches: [s("#111111", "Ink"), s("#f4efe6", "Ivory"), s("#e8e2d6", "Chalk")],
    secondarySwatches: [s("#7a6a55", "Fawn")],
    accentSwatches: [s("#9c2b2b", "Lacquer")],
    contrastScale: "High Contrast",
    ...over,
  } as DetailedColorProfile;
}

test("luminance orders dark to light and survives junk hexes", () => {
  expect(luminance("#000000")).toBeLessThan(luminance("#ffffff"));
  expect(luminance("nonsense")).toBe(0.5);
});

test("anchor combo spans the palette; tonal picks the closest neighbours", () => {
  const [anchor, tonal, statement] = buildOutfitCombos(profile());

  expect(anchor!.colors.map((c) => c.name)).toEqual(["Ink", "Ivory", "Lacquer"]);
  // Chalk/Ivory are the tightest pair — Ink is nowhere near either.
  expect(
    tonal!.colors
      .slice(0, 2)
      .map((c) => c.name)
      .sort(),
  ).toEqual(["Chalk", "Ivory"]);
  expect(statement!.colors[0]!.name).toBe("Lacquer");
});

test("contrast scale changes the anchor's advice, not its colors", () => {
  const high = buildOutfitCombos(profile())[0]!;
  const low = buildOutfitCombos(profile({ contrastScale: "Low Contrast" }))[0]!;

  expect(high.colors).toEqual(low.colors);
  expect(high.title).not.toBe(low.title);
});

test("a palette too thin to pair yields nothing rather than a fake look", () => {
  expect(buildOutfitCombos(profile({ primarySwatches: [], secondarySwatches: [] }))).toEqual([]);
});

test("falls back to a secondary when the season has no accent swatches", () => {
  const combos = buildOutfitCombos(profile({ accentSwatches: [] }));
  expect(combos[2]!.colors[0]!.name).toBe("Fawn");
});
