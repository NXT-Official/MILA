import { describe, expect, mock, test } from "bun:test";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { RateLimitExceededError } from "@/lib/rate-limit.server";
import { handleGenerationJobsReap, type HandleGenerationJobsReapDeps } from "./reap";

const USER = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";

function postRequest(token?: string, body?: unknown) {
  return new Request("https://mila.test/api/v1/generation-jobs/reap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function fakeDeps(over: Partial<HandleGenerationJobsReapDeps> = {}): HandleGenerationJobsReapDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: USER,
      claims: {} as never,
    })),
    consumeRateLimit: mock(async () => ({
      allowed: true,
      remaining: 29,
      reset_at: "2026-10-07T12:10:00.000Z",
      retry_after_seconds: 0,
    })),
    reapGenerationJobs: mock(async () => ({ available: true, reaped: 2 })),
    ...over,
  };
}

describe("POST /api/v1/generation-jobs/reap", () => {
  test("no bearer: 401, reap never called", async () => {
    const reap = mock(async () => ({ available: true, reaped: 0 }));
    const res = await handleGenerationJobsReap(
      postRequest(),
      fakeDeps({
        verifyBearerAuth: mock(async () => {
          throw new UnauthorizedError("Unauthorized: No authorization header provided");
        }),
        reapGenerationJobs: reap,
      }),
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    expect(reap).not.toHaveBeenCalled();
  });

  test("reaps only the caller (called with her id, never null, body ignored)", async () => {
    const reap = mock(async (_userId: string | null) => ({ available: true, reaped: 2 }));
    const deps = fakeDeps({ reapGenerationJobs: reap });

    const res = await handleGenerationJobsReap(
      postRequest("good-token", { userId: "someone-else" }),
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true, reaped: 2 });
    expect(reap).toHaveBeenCalledTimes(1);
    expect(reap.mock.calls[0]?.[0]).toBe(USER);
  });

  test("rate limit is keyed by her id: 30 per 600 s", async () => {
    const limit = mock(async (_key: string, _policy: { limit: number; windowSeconds: number }) => ({
      allowed: true,
      remaining: 1,
      reset_at: "x",
      retry_after_seconds: 0,
    }));
    await handleGenerationJobsReap(postRequest("t"), fakeDeps({ consumeRateLimit: limit }));

    expect(limit.mock.calls[0]).toEqual([
      `generation-jobs:reap:${USER}`,
      { limit: 30, windowSeconds: 600 },
    ]);
  });

  test("migration missing answers { available: false, reaped: 0 } with 200", async () => {
    const res = await handleGenerationJobsReap(
      postRequest("t"),
      fakeDeps({ reapGenerationJobs: mock(async () => ({ available: false, reaped: 0 })) }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false, reaped: 0 });
  });

  test("rate limited answers 429 RATE_LIMITED with retryAfter, nothing reaped", async () => {
    const reap = mock(async () => ({ available: true, reaped: 0 }));
    const res = await handleGenerationJobsReap(
      postRequest("t"),
      fakeDeps({
        consumeRateLimit: mock(async () => {
          throw new RateLimitExceededError(120);
        }),
        reapGenerationJobs: reap,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(json.error.retryAfter).toBe(120);
    expect(reap).not.toHaveBeenCalled();
  });

  test("a store error answers the calm 500", async () => {
    const spy = mock(() => {});
    const original = console.error;
    console.error = spy;
    try {
      const res = await handleGenerationJobsReap(
        postRequest("t"),
        fakeDeps({
          reapGenerationJobs: mock(async () => {
            throw new Error("connection reset by peer at db.internal:5432");
          }),
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error.code).toBe("INTERNAL");
      expect(JSON.stringify(json)).not.toContain("db.internal");
    } finally {
      console.error = original;
    }
  });
});
