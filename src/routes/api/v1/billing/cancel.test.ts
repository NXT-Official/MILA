import { describe, expect, mock, test } from "bun:test";
import { handleBillingCancel, type HandleBillingCancelDeps } from "./cancel";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { DomainValidationError } from "@/server/http/api-errors";

function fakeDeps(overrides: Partial<HandleBillingCancelDeps> = {}): HandleBillingCancelDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    cancelSubscriptionForApiUser: mock(async () => ({
      success: true as const,
      endsAt: "2026-10-01T00:00:00.000Z",
    })),
    ...overrides,
  } as HandleBillingCancelDeps;
}

function postRequest(token?: string) {
  return new Request("https://mila.test/api/v1/billing/cancel", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("POST /api/v1/billing/cancel", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleBillingCancel(postRequest(), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the scheduled end date", async () => {
    const deps = fakeDeps();
    const res = await handleBillingCancel(postRequest("good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.endsAt).toBe("2026-10-01T00:00:00.000Z");
  });

  test("no active membership -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps({
      cancelSubscriptionForApiUser: mock(async () => {
        throw new DomainValidationError("No active membership to cancel");
      }),
    });

    const res = await handleBillingCancel(postRequest("good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
  });
});
