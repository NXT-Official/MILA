import { describe, expect, test } from "bun:test";
import { DEFAULT_AI_CREDITS, InsufficientCreditsError, isInsufficientCreditsError } from "./credits";

describe("credit error contract", () => {
  test("DEFAULT_AI_CREDITS is the free-tier daily allowance", () => {
    expect(DEFAULT_AI_CREDITS).toBe(5);
  });

  test("recognizes InsufficientCreditsError", () => {
    expect(isInsufficientCreditsError(new InsufficientCreditsError())).toBe(true);
  });

  test("still recognizes it after a message-only round trip (server-fn boundary)", () => {
    // TanStack Start's ShallowErrorPlugin reconstructs thrown server errors as
    // `new Error(originalError.message)` — .name is never preserved. Anything
    // isInsufficientCreditsError checks besides .message would silently break
    // for every real call site, which all go through a server function.
    const reconstructed = new Error(new InsufficientCreditsError().message);
    expect(isInsufficientCreditsError(reconstructed)).toBe(true);
  });

  test("does not misidentify other errors", () => {
    expect(isInsufficientCreditsError(new Error("some other failure"))).toBe(false);
    expect(isInsufficientCreditsError("not an error")).toBe(false);
    expect(isInsufficientCreditsError(null)).toBe(false);
  });
});
