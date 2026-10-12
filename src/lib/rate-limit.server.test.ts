import { describe, expect, spyOn, test } from "bun:test";
import { consumeRateLimit, RateLimitExceededError, releaseRateLimit } from "./rate-limit.server";
import { MemoryRateLimitStore } from "../../tests/helpers/memory-rate-limit-store";

const policy = { limit: 3, windowSeconds: 10 };

describe("distributed rate limiter contract", () => {
  test("allows through the limit, blocks overage, and resets without real delays", async () => {
    let now = 1_000;
    const store = new MemoryRateLimitStore(() => now);

    expect((await consumeRateLimit("test:user-1", policy, store.consume))?.remaining).toBe(2);
    await consumeRateLimit("test:user-1", policy, store.consume);
    expect((await consumeRateLimit("test:user-1", policy, store.consume))?.remaining).toBe(0);
    await expect(consumeRateLimit("test:user-1", policy, store.consume)).rejects.toMatchObject({
      statusCode: 429,
      retryAfterSeconds: 10,
    });

    now += 10_000;
    expect((await consumeRateLimit("test:user-1", policy, store.consume))?.allowed).toBe(true);
  });

  test("keeps keys isolated", async () => {
    const store = new MemoryRateLimitStore(() => 0);
    const single = { limit: 1, windowSeconds: 60 };
    await consumeRateLimit("login:same", single, store.consume);

    expect((await consumeRateLimit("signup:same", single, store.consume))?.allowed).toBe(true);
    expect((await consumeRateLimit("login:other", single, store.consume))?.allowed).toBe(true);
  });

  test("atomically allows exactly five of twenty concurrent requests", async () => {
    const store = new MemoryRateLimitStore(() => 0);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimit("concurrent:one-key", { limit: 5, windowSeconds: 60 }, store.consume).then(
          () => true,
          (error) => {
            expect(error).toBeInstanceOf(RateLimitExceededError);
            return false;
          },
        ),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(5);
  });

  test("fails closed on a store error without logging the identity or the cause", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const failing = async () => {
      throw new Error("secret store detail");
    };

    await expect(consumeRateLimit("write:198.51.100.7", policy, failing)).rejects.toThrow(
      "temporarily unavailable",
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain("secret store detail");
    expect(logged).not.toContain("198.51.100.7");
    expect(logged).toContain("write");
    error.mockRestore();
  });

  test("rejects an unusable configuration", async () => {
    const store = new MemoryRateLimitStore(() => 0);
    await expect(
      consumeRateLimit("bad:ip", { limit: 0, windowSeconds: 1 }, store.consume),
    ).rejects.toThrow("Invalid rate limit configuration");
    await expect(consumeRateLimit("", policy, store.consume)).rejects.toThrow(
      "Invalid rate limit configuration",
    );
  });
});

describe("releaseRateLimit", () => {
  test("passes reset_at through as the exact string and swallows a missing function", async () => {
    // PostgREST's own text, microseconds included: never parsed into a Date.
    const resetAt = "2026-10-07T12:34:56.789123+00:00";
    const seen: Array<[string, string]> = [];
    const store = async (key: string, at: string) => {
      seen.push([key, at]);
      return true;
    };
    expect(await releaseRateLimit("ai:checkIn:user-1", resetAt, store)).toBe(true);
    expect(seen).toEqual([["ai:checkIn:user-1", resetAt]]);

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const missing = async () => {
        throw {
          code: "PGRST202",
          message: "Could not find the function public.release_rate_limit",
        };
      };
      expect(await releaseRateLimit("ai:checkIn:user-1", resetAt, missing)).toBe(false);
      const afterFirst = warn.mock.calls.length;
      expect(
        await releaseRateLimit("ai:checkIn:user-1", resetAt, async () => {
          throw { code: "42883", message: "function does not exist" };
        }),
      ).toBe(false);
      // Logged once per process at most: the second miss adds nothing.
      expect(afterFirst).toBeLessThanOrEqual(1);
      expect(warn.mock.calls.length).toBe(afterFirst);
      expect(JSON.stringify(warn.mock.calls)).not.toContain("user-1");
    } finally {
      warn.mockRestore();
    }
  });

  test("a window that was not found answers false", async () => {
    expect(
      await releaseRateLimit("ai:checkIn:user-1", "2026-10-07T12:00:00+00:00", async () => false),
    ).toBe(false);
  });

  test("any other store failure answers false, never throws, and logs only the policy", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const failing = async () => {
        throw new Error("secret store detail for 198.51.100.7");
      };
      expect(
        await releaseRateLimit("ai:bodyScan:198.51.100.7", "2026-10-07T12:00:00+00:00", failing),
      ).toBe(false);
      const logged = JSON.stringify(error.mock.calls);
      expect(logged).not.toContain("secret store detail");
      expect(logged).not.toContain("198.51.100.7");
      expect(logged).toContain("rate_limit_release_error");
    } finally {
      error.mockRestore();
    }
  });

  test("a Date reset time is sent as its ISO text", async () => {
    const seen: string[] = [];
    await releaseRateLimit(
      "ai:checkIn:user-1",
      new Date("2026-10-07T12:00:00.000Z"),
      async (_k, at) => {
        seen.push(at);
        return true;
      },
    );
    expect(seen).toEqual(["2026-10-07T12:00:00.000Z"]);
  });

  test("an unusable key or reset time answers false without calling the store", async () => {
    let called = 0;
    const store = async () => {
      called += 1;
      return true;
    };
    expect(await releaseRateLimit("", "2026-10-07T12:00:00+00:00", store)).toBe(false);
    expect(await releaseRateLimit("ai:x:u", "", store)).toBe(false);
    expect(await releaseRateLimit("ai:x:u", new Date(Number.NaN), store)).toBe(false);
    expect(called).toBe(0);
  });
});
