import { describe, expect, mock, test } from "bun:test";
import { PLAN_NOT_PURCHASABLE, createCheckoutUrlForUser } from "./billing";

/** RLS hides inactive and archived plans, so "no row" is what an unbuyable price looks like. */
function fakeDb(plan: { paddle_price_id: string } | null) {
  const chain = {
    select: (..._args: unknown[]) => chain,
    eq: (..._args: unknown[]) => chain,
    limit: (..._args: unknown[]) => chain,
    maybeSingle: async () => ({ data: plan, error: null }),
  };
  return { from: mock(() => chain) } as unknown as Parameters<typeof createCheckoutUrlForUser>[0];
}

describe("createCheckoutUrlForUser", () => {
  test("attributes the checkout to the verified caller, not to anything in the request", async () => {
    // The whole reason this endpoint exists on the server: custom_data.user_id
    // is the key the webhook grants entitlement by.
    const createCheckout = mock(async () => ({ url: "https://pay.mila.test/?_ptxn=txn_1" }));

    const result = await createCheckoutUrlForUser(
      fakeDb({ paddle_price_id: "pri_123" }),
      "user-1",
      "pri_123",
      createCheckout,
    );

    expect(result).toEqual({ url: "https://pay.mila.test/?_ptxn=txn_1" });
    expect(createCheckout).toHaveBeenCalledWith({ priceId: "pri_123", userId: "user-1" });
  });

  test("a price with no active plan behind it never reaches Paddle", async () => {
    const createCheckout = mock(async () => ({ url: "https://pay.mila.test/" }));

    const result = await createCheckoutUrlForUser(
      fakeDb(null),
      "user-1",
      "pri_archived",
      createCheckout,
    );

    expect(result).toEqual({ error: PLAN_NOT_PURCHASABLE });
    expect(createCheckout).not.toHaveBeenCalled();
  });

  test("sends the plan's own price id, not the one the caller typed", async () => {
    // Both come from the same lookup today, but reading it off the row is what
    // keeps a spoofed price id from ever reaching Paddle if that changes.
    const createCheckout = mock(async () => ({ url: "https://pay.mila.test/" }));

    await createCheckoutUrlForUser(
      fakeDb({ paddle_price_id: "pri_real" }),
      "user-1",
      "pri_real",
      createCheckout,
    );

    expect(createCheckout).toHaveBeenCalledWith({ priceId: "pri_real", userId: "user-1" });
  });

  test("a Paddle failure is reported as a retry, never as a checkout URL", async () => {
    const result = await createCheckoutUrlForUser(
      fakeDb({ paddle_price_id: "pri_123" }),
      "user-1",
      "pri_123",
      mock(async () => ({ error: { code: "forbidden" } })),
    );

    expect(result).toEqual({ error: "Checkout couldn't be opened. Try again in a moment." });
  });
});
