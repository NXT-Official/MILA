import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AI_CREDITS,
  InsufficientCreditsError,
  isInsufficientCreditsError,
} from "./credits";

describe("credit error contract", () => {
  test("the free tier has no daily allowance — credits are paid for", () => {
    expect(DEFAULT_AI_CREDITS).toBe(0);
  });

  test("recognizes InsufficientCreditsError", () => {
    expect(isInsufficientCreditsError(new InsufficientCreditsError())).toBe(true);
  });

  test("still recognizes it after a message-only round trip (server-fn boundary)", () => {
    const reconstructed = new Error(new InsufficientCreditsError().message);
    expect(isInsufficientCreditsError(reconstructed)).toBe(true);
  });

  test("does not misidentify other errors", () => {
    expect(isInsufficientCreditsError(new Error("some other failure"))).toBe(false);
    expect(isInsufficientCreditsError("not an error")).toBe(false);
    expect(isInsufficientCreditsError(null)).toBe(false);
  });
});
