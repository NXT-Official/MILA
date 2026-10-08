import { describe, expect, mock, test } from "bun:test";
import { handleConciergeChat, type HandleConciergeChatDeps } from "./chat";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { RateLimitExceededError } from "@/lib/rate-limit.server";

const VALID_INPUT = { message: "What should I wear to a rooftop dinner?", history: [] };

function fakeDeps(overrides: Partial<HandleConciergeChatDeps> = {}): HandleConciergeChatDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    conciergeChatForUser: mock(async () => ({ reply: "Try a linen blazer over a silk slip." })),
    ...overrides,
  } as HandleConciergeChatDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/concierge/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/concierge/chat", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleConciergeChat(postRequest(VALID_INPUT), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the reply", async () => {
    const deps = fakeDeps();
    const res = await handleConciergeChat(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.reply).toContain("linen blazer");
  });

  test("rate limited -> 429 RATE_LIMITED with retryAfter", async () => {
    const deps = fakeDeps({
      conciergeChatForUser: mock(async () => {
        throw new RateLimitExceededError(60);
      }),
    });

    const res = await handleConciergeChat(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(json.error.retryAfter).toBe(60);
  });

  test("with a clientRequestId the route asks for inFlight report and passes the running shape through", async () => {
    const calls: unknown[][] = [];
    const deps = fakeDeps({
      conciergeChatForUser: (async (...args: unknown[]) => {
        calls.push(args);
        return { status: "running", jobId: "job-1" };
      }) as never,
    });
    const res = await handleConciergeChat(
      postRequest(
        { ...VALID_INPUT, clientRequestId: "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f", saveTurn: true },
        "good-token",
      ),
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "running", jobId: "job-1" });
    expect(calls[0][3]).toEqual({ inFlight: "report" });
  });

  test("without a clientRequestId the route attaches (no inFlight option)", async () => {
    const calls: unknown[][] = [];
    const deps = fakeDeps({
      conciergeChatForUser: (async (...args: unknown[]) => {
        calls.push(args);
        return { reply: "ok" };
      }) as never,
    });
    const res = await handleConciergeChat(postRequest(VALID_INPUT, "good-token"), deps);
    expect(res.status).toBe(200);
    expect(calls[0]).toHaveLength(3);
  });

  test("empty message -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handleConciergeChat(postRequest({ message: "" }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.conciergeChatForUser).not.toHaveBeenCalled();
  });
});
