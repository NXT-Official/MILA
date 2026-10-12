import { describe, expect, test } from "bun:test";
import { normalizeMatchScore } from "./match-score";

describe("normalizeMatchScore", () => {
  test("rounds a float", () => expect(normalizeMatchScore(87.6)).toBe(88));
  test("clamps above 100", () => expect(normalizeMatchScore(140)).toBe(100));
  test("clamps below 0", () => expect(normalizeMatchScore(-4)).toBe(0));
  test("reads a numeric string", () => expect(normalizeMatchScore(" 72 ")).toBe(72));
  test("a non-number becomes null", () => {
    expect(normalizeMatchScore("x")).toBeNull();
    expect(normalizeMatchScore("")).toBeNull();
    expect(normalizeMatchScore(undefined)).toBeNull();
    expect(normalizeMatchScore(Number.NaN)).toBeNull();
  });
});
