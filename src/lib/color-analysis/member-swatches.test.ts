import { describe, expect, test } from "bun:test";
import { MAX_MEMBER_SWATCHES, MAX_SWATCH_NAME_LENGTH, memberSwatches } from "./member-swatches";

// Golden vectors, copied verbatim by mobile.
const V1_PROFILE = {
  season: "Autumn",
  primarySwatches: [
    { hex: "#8B4513", name: "Saddle Brown" },
    { hex: "#c19a6b", name: "Camel" },
    { hex: "#556B2F", name: "Olive" },
    { hex: "#B7410E", name: "Rust" },
  ],
  secondarySwatches: [
    { hex: "#C19A6B", name: "Camel Again" }, // same hex as Camel: dropped
    { hex: "#800020", name: "camel" }, // same name as Camel: dropped
    { hex: "#FFDB58", name: "Mustard" },
    { hex: "#nothex", name: "Broken" }, // invalid hex: dropped
    { hex: "#36454F", name: "  Charcoal  " },
    { hex: "#F5F5DC", name: "" }, // no name: dropped
    { name: "No Hex" },
    "not a swatch",
    { hex: "#2E8B57", name: "Sea Green" },
    { hex: "#FFFDD0", name: "Cream" },
    { hex: "#E2725B", name: "Terracotta" }, // ninth valid: over the cap
  ],
  accentSwatches: [{ hex: "#FF7F50", name: "Coral" }], // never read
};

const V1_EXPECTED = [
  { name: "Saddle Brown", hex: "#8B4513" },
  { name: "Camel", hex: "#C19A6B" },
  { name: "Olive", hex: "#556B2F" },
  { name: "Rust", hex: "#B7410E" },
  { name: "Mustard", hex: "#FFDB58" },
  { name: "Charcoal", hex: "#36454F" },
  { name: "Sea Green", hex: "#2E8B57" },
  { name: "Cream", hex: "#FFFDD0" },
];

const V2_PROFILE = {
  version: 2,
  season: "Spring",
  primary: [
    { hex: "#FFE5A8", name: "Light Cream" },
    { hex: "#F7B7A3", name: "Peach Pastel" },
  ],
  secondary: [{ hex: "#C8E6C9", name: "Soft Mint" }],
  accent: [{ hex: "#FF8C61", name: "Warm Coral" }],
};

describe("memberSwatches", () => {
  test("reads primary and secondary swatches, dedupes, keeps at most 8, drops invalid hex, reads the v2 quiz shape", () => {
    expect(MAX_MEMBER_SWATCHES).toBe(8);
    expect(memberSwatches(V1_PROFILE)).toEqual(V1_EXPECTED);
    expect(memberSwatches(V2_PROFILE)).toEqual([
      { name: "Light Cream", hex: "#FFE5A8" },
      { name: "Peach Pastel", hex: "#F7B7A3" },
      { name: "Soft Mint", hex: "#C8E6C9" },
    ]);
  });

  test("primary comes before secondary", () => {
    const swatches = memberSwatches({
      secondarySwatches: [{ hex: "#000000", name: "Second" }],
      primarySwatches: [{ hex: "#FFFFFF", name: "First" }],
    });
    expect(swatches.map((s) => s.name)).toEqual(["First", "Second"]);
  });

  test("a profile with only one list still reads it", () => {
    expect(memberSwatches({ primarySwatches: [{ hex: "#000000", name: "Ink" }] })).toEqual([
      { name: "Ink", hex: "#000000" },
    ]);
    expect(memberSwatches({ secondary: [{ hex: "#000000", name: "Ink" }] })).toEqual([
      { name: "Ink", hex: "#000000" },
    ]);
  });

  test("an empty current list falls back to the v2 list", () => {
    expect(
      memberSwatches({
        primarySwatches: [],
        primary: [{ hex: "#FFE5A8", name: "Light Cream" }],
        secondarySwatches: [],
        secondary: [{ hex: "#C8E6C9", name: "Soft Mint" }],
      }),
    ).toEqual([
      { name: "Light Cream", hex: "#FFE5A8" },
      { name: "Soft Mint", hex: "#C8E6C9" },
    ]);
  });

  test("names are capped at 40 characters, then trimmed and deduped", () => {
    expect(MAX_SWATCH_NAME_LENGTH).toBe(40);
    const long = `${"Deep Burgundy ".repeat(2)}${"x".repeat(5000)}`;
    const swatches = memberSwatches({
      primarySwatches: [
        { hex: "#800020", name: long },
        { hex: "#000000", name: `${long.slice(0, 40)} and more` }, // same capped name: dropped
        { hex: "#FFFFFF", name: `${"a".repeat(39)} b` }, // capped to 39 a's and a space, trimmed
      ],
    });
    expect(swatches).toEqual([
      { name: long.slice(0, 40), hex: "#800020" },
      { name: "a".repeat(39), hex: "#FFFFFF" },
    ]);
    for (const swatch of swatches) expect(swatch.name.length).toBeLessThanOrEqual(40);
  });

  test("no profile, or an unreadable one, gives no swatches", () => {
    for (const value of [null, undefined, "Autumn", 3, [], {}, { primarySwatches: "x" }]) {
      expect(memberSwatches(value)).toEqual([]);
    }
  });

  test("never mutates her profile", () => {
    const copy = JSON.parse(JSON.stringify(V1_PROFILE));
    memberSwatches(V1_PROFILE);
    expect(V1_PROFILE).toEqual(copy);
  });
});
