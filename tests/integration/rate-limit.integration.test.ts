import { describe, expect, mock, test } from "bun:test";
import { handleGlobalRateLimit } from "../../src/lib/rate-limit-middleware-handler.server";
import {
  consumeRateLimit,
  RateLimitExceededError,
  type RateLimitPolicy,
} from "../../src/lib/rate-limit.server";
import { authenticateWithPassword, type AuthDependencies } from "../../src/lib/auth-handler.server";
import { MemoryRateLimitStore } from "../helpers/memory-rate-limit-store";

const policy: RateLimitPolicy = { limit: 2, windowSeconds: 10, failure: "closed" };

describe("TanStack Start rate-limit pipeline", () => {
  test("isolates anonymous IPs, returns 429 above quota, and recovers after reset", async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now);
    const run = (ip: string) =>
      handleGlobalRateLimit(
        {
          request: new Request("https://example.test/api/action", { method: "POST" }),
          pathname: "/api/action",
          handlerType: "serverFn",
          next: async () => new Response("ok"),
        },
        {
          getIp: () => ip,
          consume: (namespace, identity) =>
            consumeRateLimit(namespace, identity, policy, 1, store.consume),
        },
      );

    expect((await run("203.0.113.1")).status).toBe(200);
    expect((await run("203.0.113.1")).status).toBe(200);
    const blocked = await run("203.0.113.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("10");
    expect((await run("203.0.113.2")).status).toBe(200);
    now = 10_000;
    expect((await run("203.0.113.1")).status).toBe(200);
  });

  test("isolates authenticated user quotas even when users share an IP", async () => {
    const store = new MemoryRateLimitStore(() => 0);
    await consumeRateLimit("user:write", "user-a", policy, 1, store.consume);
    await consumeRateLimit("user:write", "user-a", policy, 1, store.consume);
    await expect(
      consumeRateLimit("user:write", "user-a", policy, 1, store.consume),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
    expect(
      (await consumeRateLimit("user:write", "user-b", policy, 1, store.consume))?.allowed,
    ).toBe(true);
  });
});

test("auth abuse protection blocks before Supabase while preserving CAPTCHA", async () => {
  const signInWithPassword = mock(async () => ({ data: { session: null }, error: null }));
  const deps = {
    ip: () => "203.0.113.4",
    key: () => "hashed-account",
    consume: mock(async () => {
      throw new RateLimitExceededError(60);
    }),
    client: () => ({ auth: { signInWithPassword, signUp: mock() } }),
  } as unknown as AuthDependencies;
  await expect(
    authenticateWithPassword(
      "login",
      {
        email: "user@example.com",
        password: "correct-horse-battery-staple",
        captchaToken: "captcha-token",
      },
      deps,
    ),
  ).rejects.toBeInstanceOf(RateLimitExceededError);
  expect(signInWithPassword).not.toHaveBeenCalled();
});
