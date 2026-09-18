import { describe, expect, mock, test } from "bun:test";
import { handleBillingCheckoutUrl, type HandleBillingCheckoutUrlDeps } from "./checkout-url";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { DomainValidationError } from "@/server/http/api-errors";

const PLAN_ID = "11111111-1111-1111-1111-111111111111";

function fakeDeps(
  overrides: Partial<HandleBillingCheckoutUrlDeps> = {},
): HandleBillingCheckoutUrlDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: { email: "member@example.com" } as never,
    })),
    getCheckoutUrlForUser: mock(async () => ({
      checkoutUrl: "https://sandbox-buy.paddle.com/checkout/abc123",
    })),
    ...overrides,
  } as HandleBillingCheckoutUrlDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/billing/checkout-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/billing/checkout-url", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleBillingCheckoutUrl(postRequest({ planId: PLAN_ID }), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the checkout url", async () => {
    const deps = fakeDeps();
    const res = await handleBillingCheckoutUrl(
      postRequest({ planId: PLAN_ID }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.checkoutUrl).toContain("paddle.com");
    expect(deps.getCheckoutUrlForUser).toHaveBeenCalledWith(
      {},
      "user-1",
      { planId: PLAN_ID },
      "member@example.com",
    );
  });

  test("plan unavailable for checkout -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps({
      getCheckoutUrlForUser: mock(async () => {
        throw new DomainValidationError("That plan isn't available for checkout.");
      }),
    });

    const res = await handleBillingCheckoutUrl(
      postRequest({ planId: PLAN_ID }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
  });

  test("invalid planId -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handleBillingCheckoutUrl(
      postRequest({ planId: "not-a-uuid" }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.getCheckoutUrlForUser).not.toHaveBeenCalled();
  });
});
