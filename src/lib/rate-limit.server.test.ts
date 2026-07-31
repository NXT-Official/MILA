import { describe, expect, spyOn, test } from "bun:test";
import { consumeRateLimit, RateLimitExceededError } from "./rate-limit.server";
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
