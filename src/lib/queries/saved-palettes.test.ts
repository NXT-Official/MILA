import { describe, expect, it } from "bun:test";
import { isDailyPalette } from "./saved-palettes";

const LOOK = {
  baseColor: "Champagne",
  statementColor: "Soft Pistachio",
  accentColor: "Rose Clay",
  baseHex: "#E8D5B0",
  statementHex: "#CFDDB4",
  accentHex: "#C9897C",
  isSisterSeasonIncluded: false,
  styleVibe: "Modern Classic",
  insight: "A grounded base with one signature lift.",
};

describe("saved palette rows", () => {
  it("accepts a palette written by the current app", () => {
    expect(isDailyPalette(LOOK)).toBe(true);
  });

  it("rejects shapes jsonb can legally hold but the card cannot render", () => {
    const { accentHex: _dropped, ...missingField } = LOOK;
    expect(isDailyPalette(missingField)).toBe(false);
    expect(isDailyPalette({ ...LOOK, isSisterSeasonIncluded: "no" })).toBe(false);
    expect(isDailyPalette({ ...LOOK, baseHex: 16777215 })).toBe(false);
    expect(isDailyPalette([LOOK])).toBe(false);
    expect(isDailyPalette("a string")).toBe(false);
    expect(isDailyPalette(null)).toBe(false);
  });
});
