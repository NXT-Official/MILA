import { describe, expect, test } from "bun:test";
import { ApiError } from "@/server/api/respond";
import { RateLimitExceededError } from "@/lib/rate-limit.server";
import { toSupportApiError } from "./support";

/**
 * The mapping the phone switches on. A code that lands in the wrong branch is a
 * member staring at "something went wrong" when the real answer was "your
 * captcha expired, try again" — so every branch is pinned.
 */
describe("toSupportApiError", () => {
  test("carries the rate limit's own countdown through, not a guessed one", () => {
    const mapped = toSupportApiError(new RateLimitExceededError(420));

    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.status).toBe(429);
    expect(mapped.retryAfter).toBe(420);
  });

  test("a spent or failed captcha is the member's to retry, inline", () => {
    const mapped = toSupportApiError(new Error("Captcha verification failed. Please try again."));

    expect(mapped.code).toBe("VALIDATION_FAILED");
    expect(mapped.status).toBe(400);
    expect(mapped.message).toBe("Captcha verification failed. Please try again.");
  });

  test("a missing captcha secret is ours, not hers", () => {
    const mapped = toSupportApiError(
      new Error("Captcha verification is not available. Please try again later."),
    );

    expect(mapped.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(mapped.status).toBe(503);
  });

  test("an unreachable rate-limit store fails open to a retry, not a validation error", () => {
    const mapped = toSupportApiError(new Error("Request protection is temporarily unavailable."));

    expect(mapped.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(mapped.status).toBe(503);
  });

  test("a Postgres error never reaches the member as itself", () => {
    const mapped = toSupportApiError(
      new Error('duplicate key value violates unique constraint "x"'),
    );

    expect(mapped.code).toBe("INTERNAL");
    expect(mapped.status).toBe(500);
    expect(mapped.message).not.toContain("constraint");
  });

  test("an ApiError thrown deliberately passes through untouched", () => {
    const original = new ApiError("VALIDATION_FAILED", "That message couldn't be sent.", 400);

    expect(toSupportApiError(original)).toBe(original);
  });
});
