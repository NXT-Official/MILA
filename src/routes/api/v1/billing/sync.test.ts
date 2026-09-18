import { describe, expect, mock, test } from "bun:test";
import { handleBillingSync, type HandleBillingSyncDeps } from "./sync";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";

function fakeDeps(overrides: Partial<HandleBillingSyncDeps> = {}): HandleBillingSyncDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    syncPurchaseForUser: mock(async () => ({ synced: true })),
    ...overrides,
  } as HandleBillingSyncDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/billing/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/billing/sync", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleBillingSync(postRequest({ transactionId: "txn_123" }), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 synced", async () => {
    const deps = fakeDeps();
    const res = await handleBillingSync(
      postRequest({ transactionId: "txn_123" }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.synced).toBe(true);
    expect(deps.syncPurchaseForUser).toHaveBeenCalledWith("user-1", "txn_123");
  });

  test("transaction doesn't belong to caller -> 200 synced:false", async () => {
    const deps = fakeDeps({ syncPurchaseForUser: mock(async () => ({ synced: false })) });
    const res = await handleBillingSync(
      postRequest({ transactionId: "txn_123" }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.synced).toBe(false);
  });

  test("missing transactionId -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handleBillingSync(postRequest({}, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.syncPurchaseForUser).not.toHaveBeenCalled();
  });
});
