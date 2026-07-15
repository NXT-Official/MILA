import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  accountKey,
  clientIp,
  consumeRateLimit,
  isRateLimitExempt,
  normalizeIp,
  RATE_LIMIT_POLICIES,
  RateLimitExceededError,
} from "./rate-limit.server";
import { MemoryRateLimitStore } from "../../tests/helpers/memory-rate-limit-store";

const originalHeader = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
afterEach(() => {
  if (originalHeader === undefined) delete process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  else process.env.RATE_LIMIT_TRUSTED_IP_HEADER = originalHeader;
});

describe("distributed rate limiter contract", () => {
  test("allows through the limit, blocks weighted overage, and resets without real delays", async () => {
    let now = 1_000;
    const store = new MemoryRateLimitStore(() => now);
    const policy = { limit: 5, windowSeconds: 10, failure: "closed" as const };
    const first = await consumeRateLimit("test", "user-1", policy, 2, store.consume);
    const final = await consumeRateLimit("test", "user-1", policy, 3, store.consume);
    expect(first?.remaining).toBe(3);
    expect(final?.remaining).toBe(0);
    await expect(
      consumeRateLimit("test", "user-1", policy, 1, store.consume),
    ).rejects.toMatchObject({
      statusCode: 429,
      retryAfterSeconds: 10,
    });
    now += 10_000;
    expect((await consumeRateLimit("test", "user-1", policy, 1, store.consume))?.allowed).toBe(
      true,
    );
  });

  test("keeps namespaces and identities isolated", async () => {
    const store = new MemoryRateLimitStore(() => 0);
    const policy = { limit: 1, windowSeconds: 60, failure: "closed" as const };
    await consumeRateLimit("login", "same", policy, 1, store.consume);
    expect((await consumeRateLimit("signup", "same", policy, 1, store.consume))?.allowed).toBe(
      true,
    );
    expect((await consumeRateLimit("login", "other", policy, 1, store.consume))?.allowed).toBe(
      true,
    );
  });

  test("atomically allows exactly five of twenty concurrent requests", async () => {
    const store = new MemoryRateLimitStore(() => 0);
    const policy = { limit: 5, windowSeconds: 60, failure: "closed" as const };
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimit("concurrent", "one-key", policy, 1, store.consume).then(
          () => true,
          (error) => {
            expect(error).toBeInstanceOf(RateLimitExceededError);
            return false;
          },
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(results.filter((allowed) => !allowed)).toHaveLength(15);
  });

  test("validates configuration and applies fail-open or fail-closed store errors", async () => {
    const failing = async () => {
      throw new Error("secret store detail");
    };
    const logger = { error: mock(() => {}), warn: mock(() => {}) };
    await expect(
      consumeRateLimit(
        "read",
        "ip",
        { limit: 1, windowSeconds: 1, failure: "open" },
        1,
        failing,
        logger,
      ),
    ).resolves.toBeUndefined();
    await expect(
      consumeRateLimit(
        "write",
        "ip",
        { limit: 1, windowSeconds: 1, failure: "closed" },
        1,
        failing,
        logger,
      ),
    ).rejects.toThrow("temporarily unavailable");
    await expect(
      consumeRateLimit(
        "bad",
        "ip",
        { limit: 0, windowSeconds: 1, failure: "closed" },
        1,
        failing,
        logger,
      ),
    ).rejects.toThrow("Invalid rate limit configuration");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret store detail");
  });
});

describe("identity protection", () => {
  test("normalizes supported IP forms and rejects invalid or port-appended values", () => {
    expect(normalizeIp(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(normalizeIp("2001:DB8::1%eth0")).toBe("2001:db8::1");
    expect(normalizeIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(normalizeIp("203.0.113.7:443")).toBeUndefined();
    expect(normalizeIp("bad-value")).toBeUndefined();
  });

  test("ignores forwarding headers unless one exact deployment header is configured", () => {
    const request = new Request("https://example.test", {
      headers: {
        "x-forwarded-for": "198.51.100.1",
        "x-real-ip": "198.51.100.2",
        "cf-connecting-ip": "198.51.100.3",
      },
    });
    delete process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
    expect(clientIp(request, () => "192.0.2.9")).toBe("192.0.2.9");
    process.env.RATE_LIMIT_TRUSTED_IP_HEADER = "CF-Connecting-IP";
    expect(clientIp(request, () => "192.0.2.9")).toBe("198.51.100.3");
  });

  test("hashes normalized emails without exposing them and varies by secret", () => {
    const first = accountKey(" User@Example.com ", "test-secret");
    expect(first).toBe(accountKey("user@example.com", "test-secret"));
    expect(first).not.toContain("user@example.com");
    expect(first).not.toBe(accountKey("user@example.com", "other-secret"));
    expect(() => accountKey(" ", "test-secret")).toThrow("required");
  });
});

test("policies are valid, unique by name, and sensitive limits are stricter", () => {
  const entries = Object.entries(RATE_LIMIT_POLICIES);
  expect(new Set(entries.map(([name]) => name)).size).toBe(entries.length);
  for (const [, policy] of entries) {
    expect(policy.limit).toBeGreaterThan(0);
    expect(policy.windowSeconds).toBeGreaterThan(0);
  }
  expect(RATE_LIMIT_POLICIES.loginAccount.limit).toBeLessThan(
    RATE_LIMIT_POLICIES.anonymousPage.limit,
  );
  expect(RATE_LIMIT_POLICIES.signupAccount.limit).toBeLessThan(
    RATE_LIMIT_POLICIES.generalFunction.limit,
  );
});

test("exempts static assets, fonts, health, and favicons but not API routes", () => {
  for (const path of [
    "/assets/app.js",
    "/x.css",
    "/x.png",
    "/x.woff2",
    "/favicon.ico",
    "/health",
  ]) {
    expect(isRateLimitExempt(path)).toBe(true);
  }
  expect(isRateLimitExempt("/api/upload")).toBe(false);
});
