import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AI_CREDITS,
  InsufficientCreditsError,
  effectiveCredits,
  isInsufficientCreditsError,
  utcDay,
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

describe("effectiveCredits", () => {
  const today = "2026-09-30";

  test("a subscriber who hasn't used anything today sees the full allowance", () => {
    expect(
      effectiveCredits({
        aiCredits: 4,
        purchasedCredits: 0,
        creditsResetAt: "2026-09-29",
        planAllowance: 30,
        today,
      }),
    ).toBe(30);
  });

  test("once today's bucket exists, what is left of it is what counts", () => {
    expect(
      effectiveCredits({
        aiCredits: 27,
        purchasedCredits: 0,
        creditsResetAt: today,
        planAllowance: 30,
        today,
      }),
    ).toBe(27);
  });

  test("purchased credits are the member's own and survive the day rolling over", () => {
    expect(
      effectiveCredits({
        aiCredits: 0,
        purchasedCredits: 12,
        creditsResetAt: "2026-09-29",
        planAllowance: 30,
        today,
      }),
    ).toBe(42);
  });

  test("without a live plan the daily bucket is worth nothing, not yesterday's leftovers", () => {
    expect(
      effectiveCredits({
        aiCredits: 18,
        purchasedCredits: 5,
        creditsResetAt: "2026-09-29",
        planAllowance: null,
        today,
      }),
    ).toBe(5);
  });

  test("an expired membership mid-day keeps only what it hasn't spent today", () => {
    expect(
      effectiveCredits({
        aiCredits: 18,
        purchasedCredits: 0,
        creditsResetAt: today,
        planAllowance: null,
        today,
      }),
    ).toBe(18);
  });
});

describe("utcDay", () => {
  test("matches the UTC clock the credit RPCs bucket by", () => {
    expect(utcDay(new Date("2026-09-30T23:59:59Z"))).toBe("2026-09-30");
    expect(utcDay(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10-01");
  });
});
