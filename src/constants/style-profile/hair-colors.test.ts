import { describe, expect, test } from "bun:test";
import { HAIR_COLORS, HAIR_COLOR_OPTIONS, isHairColor } from "./hair-colors";
import * as styleProfile from "./index";

// Golden vector: the stored values, in order. Mobile copies this list verbatim.
const GOLDEN = [
  "Black",
  "Dark brown",
  "Medium brown",
  "Light brown",
  "Auburn",
  "Red",
  "Golden blonde",
  "Ash blonde",
  "Platinum blonde",
  "Grey or silver",
  "White",
  "Vivid dyed shade",
];

const DASHES = /[-‐-―−]/;

describe("HAIR_COLORS", () => {
  test("is the shared list of stored values, in order", () => {
    expect([...HAIR_COLORS]).toEqual(GOLDEN);
  });

  test("every value is 1 to 40 characters with no dashes", () => {
    for (const value of HAIR_COLORS) {
      expect(value.length).toBeGreaterThanOrEqual(1);
      expect(value.length).toBeLessThanOrEqual(40);
      expect(value).not.toMatch(DASHES);
      expect(value).toBe(value.trim());
    }
  });

  test("never uses the word colour or color, so both apps store the same values", () => {
    for (const value of HAIR_COLORS) expect(value.toLowerCase()).not.toMatch(/colou?r/);
  });

  test("values are unique", () => {
    expect(new Set(HAIR_COLORS).size).toBe(HAIR_COLORS.length);
  });
});

describe("isHairColor", () => {
  test("accepts exactly the stored values", () => {
    for (const value of HAIR_COLORS) expect(isHairColor(value)).toBe(true);
  });

  test("refuses anything else, including other casing and padding", () => {
    for (const value of ["black", " Black", "Brown", "", "Blue", null, undefined, 3, {}]) {
      expect(isHairColor(value)).toBe(false);
    }
  });
});

describe("HAIR_COLOR_OPTIONS", () => {
  test("one option per value, titled by its value", () => {
    expect(HAIR_COLOR_OPTIONS.map((o) => o.value)).toEqual(GOLDEN);
    for (const option of HAIR_COLOR_OPTIONS) expect(option.title).toBe(option.value);
  });

  test("each has a one-line description with no dashes", () => {
    for (const option of HAIR_COLOR_OPTIONS) {
      expect(option.description.trim().length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
      expect(option.description).not.toMatch(DASHES);
    }
  });

  test("descriptions never say color or colour, so mobile can copy them verbatim", () => {
    for (const option of HAIR_COLOR_OPTIONS) {
      expect(option.description.toLowerCase()).not.toMatch(/colou?r/);
    }
  });

  test("is exported from the style-profile constants", () => {
    expect(styleProfile.HAIR_COLORS).toBe(HAIR_COLORS);
    expect(styleProfile.HAIR_COLOR_OPTIONS).toBe(HAIR_COLOR_OPTIONS);
    expect(styleProfile.isHairColor).toBe(isHairColor);
  });
});
