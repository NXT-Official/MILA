import { describe, expect, test } from "bun:test";
import { INSUFFICIENT_CREDITS } from "@/lib/credits";
import { TimeoutError } from "@/lib/utils";
import {
  BODY_SCAN_FAILED,
  BODY_SCAN_NOT_FULL_LENGTH,
  BODY_SCAN_PHOTO_TOO_LARGE,
  BODY_SCAN_RATE_LIMITED,
  BODY_SCAN_UNAVAILABLE,
} from "@/server/services/body-scan";
import { MAX_PHOTO_CHARS } from "@/server/services/body-read";
import {
  BODY_SCAN_CODES,
  BODY_SCAN_MAX_PHOTO_CHARS,
  BODY_SCAN_STILL_FINISHING,
  describeBodyScanError,
  isBodyScanInFlight,
  isLostBodyScanAnswer,
} from "./body-scan-errors";

describe("body scan codes", () => {
  test("match the server's codes and photo cap (the client never imports the server module)", () => {
    expect(BODY_SCAN_CODES).toEqual({
      NOT_FULL_LENGTH: BODY_SCAN_NOT_FULL_LENGTH,
      RATE_LIMITED: BODY_SCAN_RATE_LIMITED,
      PHOTO_TOO_LARGE: BODY_SCAN_PHOTO_TOO_LARGE,
      UNAVAILABLE: BODY_SCAN_UNAVAILABLE,
      FAILED: BODY_SCAN_FAILED,
    });
    expect(BODY_SCAN_MAX_PHOTO_CHARS).toBe(MAX_PHOTO_CHARS);
  });
});

describe("describeBodyScanError", () => {
  test("not full length says so and offers the two questions", () => {
    const failure = describeBodyScanError(BODY_SCAN_NOT_FULL_LENGTH);
    expect(failure.message).toBe(
      "I couldn't see your whole body. Try again from further back, or answer two questions instead.",
    );
    expect(failure.offerQuiz).toBe(true);
    expect(failure.outOfCredits).toBe(false);
  });

  test("rate limited, too large and still finishing each read their own line", () => {
    expect(describeBodyScanError(BODY_SCAN_RATE_LIMITED).message).toBe(
      "That's a lot of scans in a short while. Please try again later.",
    );
    expect(describeBodyScanError(BODY_SCAN_PHOTO_TOO_LARGE).message).toBe(
      "That photo is too large. Try another one.",
    );
    expect(describeBodyScanError(BODY_SCAN_STILL_FINISHING).message).toBe(
      "Mila is still finishing your last scan. Try again in a moment.",
    );
  });

  test("out of credits opens the memberships dialog instead of a line", () => {
    const failure = describeBodyScanError(INSUFFICIENT_CREDITS);
    expect(failure.outOfCredits).toBe(true);
  });

  test("a missing migration hides the scan with no copy", () => {
    const failure = describeBodyScanError(BODY_SCAN_UNAVAILABLE);
    expect(failure.unavailable).toBe(true);
    expect(failure.message).toBe("");
  });

  test("failed, a missing key, an unknown code or nothing at all get the refund line", () => {
    for (const code of [
      BODY_SCAN_FAILED,
      "CONFIG_MISSING_API_KEY",
      "reaped",
      "",
      null,
      undefined,
    ]) {
      const failure = describeBodyScanError(code);
      expect(failure.message).toBe(
        "Mila couldn't read that photo. Any credit it used has been returned. Please try again.",
      );
      expect(failure.offerQuiz).toBe(false);
      expect(failure.outOfCredits).toBe(false);
      expect(failure.unavailable).toBe(false);
    }
  });

  test("never shows a code, and no line has an em or en dash", () => {
    const codes = [
      ...Object.values(BODY_SCAN_CODES),
      BODY_SCAN_STILL_FINISHING,
      INSUFFICIENT_CREDITS,
      "SOMETHING_ELSE",
    ];
    for (const code of codes) {
      const { message } = describeBodyScanError(code);
      expect(message).not.toMatch(/[–—]/);
      expect(message).not.toMatch(/[A-Z]{2,}_[A-Z]/);
    }
  });
});

describe("thrown answers", () => {
  test("still finishing: by name, by a 429 that is not the hourly limit, or by its text", () => {
    const named = new Error("x");
    named.name = "GenerationInFlightError";
    expect(isBodyScanInFlight(named)).toBe(true);

    const status = Object.assign(new Error("x"), { statusCode: 429 });
    expect(isBodyScanInFlight(status)).toBe(true);

    const plainLimit = Object.assign(new Error("Too many requests"), { statusCode: 429 });
    plainLimit.name = "RateLimitExceededError";
    expect(isBodyScanInFlight(plainLimit)).toBe(false);

    expect(
      isBodyScanInFlight(new Error("Mila is still finishing your last request. Try again.")),
    ).toBe(true);
    expect(isBodyScanInFlight(new Error("boom"))).toBe(false);
    expect(isBodyScanInFlight("still finishing your last request")).toBe(false);
  });

  test("a lost answer: a timeout, a dropped connection or a stale bundle", () => {
    expect(isLostBodyScanAnswer(new TimeoutError())).toBe(true);
    expect(isLostBodyScanAnswer(new TypeError("Failed to fetch"))).toBe(true);
    expect(isLostBodyScanAnswer(new TypeError("NetworkError when attempting to fetch"))).toBe(true);
    expect(isLostBodyScanAnswer(new Error("Load failed"))).toBe(true);
    expect(isLostBodyScanAnswer(new Error("boom"))).toBe(false);
  });
});
