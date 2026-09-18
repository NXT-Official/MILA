import { describe, expect, mock, test } from "bun:test";
import { handleBillingResume, type HandleBillingResumeDeps } from "./resume";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { DomainValidationError } from "@/server/http/api-errors";

function fakeDeps(overrides: Partial<HandleBillingResumeDeps> = {}): HandleBillingResumeDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    resumeSubscriptionForApiUser: mock(async () => ({
      success: true as const,
      renewsAt: "2026-10-01T00:00:00.000Z",
    })),
    ...overrides,
  } as HandleBillingResumeDeps;
}

function postRequest(token?: string) {
  return new Request("https://mila.test/api/v1/billing/resume", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("POST /api/v1/billing/resume", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleBillingResume(postRequest(), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the next renewal date", async () => {
    const deps = fakeDeps();
    const res = await handleBillingResume(postRequest("good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.renewsAt).toBe("2026-10-01T00:00:00.000Z");
  });

  test("no membership to renew -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps({
      resumeSubscriptionForApiUser: mock(async () => {
        throw new DomainValidationError("No membership to renew");
      }),
    });

    const res = await handleBillingResume(postRequest("good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
  });
});
