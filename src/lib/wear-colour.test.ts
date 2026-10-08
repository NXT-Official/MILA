import { describe, expect, test } from "bun:test";
import {
  MAX_SAVED_COLOUR_MAP_ROWS,
  WEAR_ROLES,
  asWearColour,
  colourMapRows,
  defaultRoleFor,
  fallbackWearColour,
  firstSentence,
  hydrateWearColour,
  toSavedColourMap,
  type ColourMapPick,
} from "./wear-colour";

// Golden vectors, copied verbatim by mobile (D-M4). L* of each hex, from
// colour-math: Camel 66.1455, Olive 42.2339, Charcoal 28.3927, Cream 98.4583.
const SWATCHES = [
  { name: "Camel", hex: "#C19A6B" },
  { name: "Olive", hex: "#556B2F" },
  { name: "Charcoal", hex: "#36454F" },
  { name: "Cream", hex: "#FFFDD0" },
];

describe("wear colour", () => {
  test("the hex always comes from her swatch, never the model", () => {
    expect(hydrateWearColour({ swatch: "Olive", role: "base", hex: "#000000" }, SWATCHES)).toEqual({
      name: "Olive",
      hex: "#556B2F",
      role: "base",
    });
    // Her own spelling of the name is kept, whatever case the model used.
    expect(hydrateWearColour({ swatch: " olive ", role: "statement" }, SWATCHES)).toEqual({
      name: "Olive",
      hex: "#556B2F",
      role: "statement",
    });
    // A lower-case swatch hex is stored in one canonical case.
    expect(
      hydrateWearColour({ swatch: "Rose", role: "accent" }, [{ name: "Rose", hex: "#e8b4b8" }]),
    ).toEqual({ name: "Rose", hex: "#E8B4B8", role: "accent" });
  });

  test("an unknown swatch name gives null", () => {
    expect(hydrateWearColour({ swatch: "Neon Lime", role: "base" }, SWATCHES)).toBeNull();
    expect(hydrateWearColour({ swatch: "Olive", role: "base" }, [])).toBeNull();
    expect(hydrateWearColour({ role: "base" }, SWATCHES)).toBeNull();
    expect(hydrateWearColour("Olive", SWATCHES)).toBeNull();
    expect(hydrateWearColour(null, SWATCHES)).toBeNull();
    expect(hydrateWearColour(undefined, SWATCHES)).toBeNull();
    // A swatch whose own hex is broken is never worn.
    expect(
      hydrateWearColour({ swatch: "Broken", role: "base" }, [{ name: "Broken", hex: "#nothex" }]),
    ).toBeNull();
  });

  test("role must be base, statement or accent", () => {
    expect(WEAR_ROLES).toEqual(["base", "statement", "accent"]);
    expect(hydrateWearColour({ swatch: "Olive", role: "hero" }, SWATCHES)).toBeNull();
    expect(hydrateWearColour({ swatch: "Olive", role: "Base" }, SWATCHES)).toBeNull();
    expect(hydrateWearColour({ swatch: "Olive" }, SWATCHES)).toBeNull();
  });

  test("default roles by garment kind", () => {
    expect(defaultRoleFor("top")).toBe("statement");
    expect(defaultRoleFor("dress")).toBe("statement");
    expect(defaultRoleFor("bottoms")).toBe("base");
    expect(defaultRoleFor("outerwear")).toBe("base");
    expect(defaultRoleFor("shoes")).toBe("accent");
    expect(defaultRoleFor("bag")).toBe("accent");
    expect(defaultRoleFor("jewelry")).toBe("accent");
    expect(defaultRoleFor("accessory")).toBe("accent");
    // A piece no shelf names is treated as a small finishing piece.
    expect(defaultRoleFor("unknown")).toBe("accent");
  });

  test("the backfill base is her deepest swatch", () => {
    expect(fallbackWearColour("outerwear", SWATCHES)).toEqual({
      name: "Charcoal",
      hex: "#36454F",
      role: "base",
    });
    // The role still follows the piece.
    expect(fallbackWearColour("shoes", SWATCHES)).toEqual({
      name: "Charcoal",
      hex: "#36454F",
      role: "accent",
    });
    // On a tie the first swatch wins; a broken hex is never chosen.
    expect(
      fallbackWearColour("outerwear", [
        { name: "Ink", hex: "#000001" },
        { name: "Broken", hex: "#000" },
        { name: "Ink Again", hex: "#000001" },
      ]),
    ).toEqual({ name: "Ink", hex: "#000001", role: "base" });
    expect(fallbackWearColour("outerwear", [])).toBeNull();
  });

  test("rows run head to toe and skip similar picks", () => {
    const picks: ColourMapPick[] = [
      {
        id: "shoes-1",
        title: "Suede Loafers | Tan | 38",
        category: "Shoes",
        rationale: "Grounds the look. A warm finish near the floor.",
        source: "planned",
        wear_colour: { name: "Camel", hex: "#C19A6B", role: "accent" },
      },
      {
        id: "top-1",
        title: "Silk Camp Shirt",
        category: "Tops",
        rationale: "Lifts the face, e.g. through a soft open collar.",
        wear_colour: { name: "Cream", hex: "#FFFDD0", role: "statement" },
      },
      {
        id: "similar-1",
        title: "Wide Leg Trousers",
        category: "Bottoms",
        rationale: "Another option.",
        source: "similar",
        wear_colour: { name: "Olive", hex: "#556B2F", role: "base" },
      },
      {
        id: "bottoms-1",
        title: "High Rise Straight Jeans",
        category: "Bottoms",
        rationale: "Balances the volume up top.",
        source: "planned",
      },
      {
        id: "coat-1",
        title: "Wool Overcoat",
        category: "Outerwear",
        rationale: "Keeps the line long.",
        source: "planned",
        wear_colour: { name: "Charcoal", hex: "#36454F", role: "base" },
      },
    ];

    expect(colourMapRows(picks)).toEqual([
      {
        id: "coat-1",
        kind: "outerwear",
        label: "Coat",
        title: "Wool Overcoat",
        wear: { name: "Charcoal", hex: "#36454F", role: "base" },
        reason: "Keeps the line long.",
      },
      {
        id: "top-1",
        kind: "top",
        label: "Shirt",
        title: "Silk Camp Shirt",
        wear: { name: "Cream", hex: "#FFFDD0", role: "statement" },
        reason: "Lifts the face, e.g. through a soft open collar.",
      },
      {
        id: "bottoms-1",
        kind: "bottoms",
        label: "Jeans",
        title: "High Rise Straight Jeans",
        wear: null,
        reason: "Balances the volume up top.",
      },
      {
        id: "shoes-1",
        kind: "shoes",
        label: "Loafers",
        title: "Suede Loafers",
        wear: { name: "Camel", hex: "#C19A6B", role: "accent" },
        reason: "Grounds the look.",
      },
    ]);
    expect(colourMapRows([])).toEqual([]);
  });

  test("a stored or echoed colour is read back only when it is whole and safe", () => {
    expect(asWearColour({ name: "Olive", hex: "#556b2f", role: "base" })).toEqual({
      name: "Olive",
      hex: "#556B2F",
      role: "base",
    });
    expect(asWearColour({ name: "Olive", hex: "red", role: "base" })).toBeNull();
    expect(
      asWearColour({ name: "Olive", hex: "#556B2F;background:url(x)", role: "base" }),
    ).toBeNull();
    expect(asWearColour({ name: "", hex: "#556B2F", role: "base" })).toBeNull();
    expect(asWearColour({ name: "x".repeat(41), hex: "#556B2F", role: "base" })).toBeNull();
    expect(asWearColour({ name: "Olive", hex: "#556B2F", role: "hero" })).toBeNull();
    expect(asWearColour(null)).toBeNull();
    expect(asWearColour("Olive")).toBeNull();
  });

  test("the reason is the rationale's first sentence, at most 140 characters", () => {
    expect(firstSentence("Balances the volume up top. Also works for dinner.")).toBe(
      "Balances the volume up top.",
    );
    expect(firstSentence("  Warm against her skin!  Second line.")).toBe("Warm against her skin!");
    // An abbreviation followed by a lower-case word is not a sentence end.
    expect(firstSentence("Soft collars, e.g. a camp collar, open the face. Then more.")).toBe(
      "Soft collars, e.g. a camp collar, open the face.",
    );
    expect(firstSentence("No full stop at all")).toBe("No full stop at all");
    expect(firstSentence("")).toBe("");
    const long = `${"word ".repeat(40).trim()}.`;
    const cut = firstSentence(long, 140);
    expect(cut.length).toBeLessThanOrEqual(140);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
    expect(cut).not.toMatch(/[–—]/);
  });

  test("the reason never shows an em or en dash: a comma, or a hyphen between digits", () => {
    // Golden vectors, copied verbatim by mobile (D-M4).
    const vectors: Array<[string, string]> = [
      [
        "Added for today's temperature — structural outerwear the look was missing.",
        "Added for today's temperature, structural outerwear the look was missing.",
      ],
      ["Light layers suit 55–75°F days.", "Light layers suit 55-75°F days."],
      ["Sizes 4 — 8 run small.", "Sizes 4-8 run small."],
      ["Soft—never stiff—against her skin.", "Soft, never stiff, against her skin."],
      ["Cuts – twice – here. Next.", "Cuts, twice, here."],
      ["— Starts on a dash.", "Starts on a dash."],
      ["Ends on a dash —", "Ends on a dash"],
      ["Warm against her skin —.", "Warm against her skin."],
      ["A figure dash ‒ and a bar ― too.", "A figure dash, and a bar, too."],
      ["Keeps a plain hyphen in face-framing.", "Keeps a plain hyphen in face-framing."],
    ];
    for (const [input, expected] of vectors) {
      expect(firstSentence(input)).toBe(expected);
    }
    const long = `Lifts the face — ${"word ".repeat(40).trim()}.`;
    expect(firstSentence(long)).not.toMatch(/[‒–—―]/);
  });

  test("a saved colour map is compact: no prices, at most 12 rows, empty with no colours", () => {
    const pick = (n: number): ColourMapPick & { price: number; affiliate_link: string } => ({
      id: `p${n}`,
      title: `Ribbed Tank ${n} | Black | M`,
      category: "Tops",
      rationale: "Clean line.",
      source: "planned",
      price: 40 + n,
      affiliate_link: `https://shop.example/p${n}`,
      wear_colour: { name: "Olive", hex: "#556B2F", role: "statement" },
    });
    const saved = toSavedColourMap([pick(1)]);
    expect(saved).toEqual([
      {
        kind: "top",
        label: "Tank top",
        title: "Ribbed Tank 1",
        wear: { name: "Olive", hex: "#556B2F", role: "statement" },
      },
    ]);
    expect(JSON.stringify(saved)).not.toContain("price");
    expect(JSON.stringify(saved)).not.toContain("https://");

    const many = Array.from({ length: 15 }, (_, n) => pick(n));
    expect(toSavedColourMap(many)).toHaveLength(MAX_SAVED_COLOUR_MAP_ROWS);
    expect(MAX_SAVED_COLOUR_MAP_ROWS).toBe(12);

    expect(
      toSavedColourMap([{ id: "x", title: "Tee", category: "Tops", rationale: "Fine." }]),
    ).toEqual([]);
  });
});
