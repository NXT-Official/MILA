import { describe, expect, test } from "bun:test";
import { DEFAULT_AI_CREDITS, InsufficientCreditsError, isInsufficientCreditsError } from "./credits";

describe("credit error contract", () => {
  test("DEFAULT_AI_CREDITS is the free-tier daily allowance", () => {
    expect(DEFAULT_AI_CREDITS).toBe(5);
  });

  test("recognizes InsufficientCreditsError", () => {
    expect(isInsufficientCreditsError(new InsufficientCreditsError())).toBe(true);
  });

  test("does not misidentify other errors", () => {
    expect(isInsufficientCreditsError(new Error("some other failure"))).toBe(false);
    expect(isInsufficientCreditsError("not an error")).toBe(false);
    expect(isInsufficientCreditsError(null)).toBe(false);
  });
});
