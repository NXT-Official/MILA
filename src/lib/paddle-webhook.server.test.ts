import { describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import { applyPaddleSubscriptionEvent, verifyPaddleSignature, type PaddleSubscriptionWebhookEvent } from "./paddle-webhook.server";

const secret = "whsec_test_secret";

function signedHeader(body: string, ts: string, withSecret = secret): string {
  const h1 = createHmac("sha256", withSecret).update(`${ts}:${body}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

describe("verifyPaddleSignature", () => {
  test("accepts a correctly signed payload", () => {
    const body = JSON.stringify({ event_type: "subscription.created" });
    const header = signedHeader(body, "1700000000");
    expect(verifyPaddleSignature(body, header, secret)).toBe(true);
  });

  test("rejects a tampered body", () => {
    const body = JSON.stringify({ event_type: "subscription.created" });
    const header = signedHeader(body, "1700000000");
    expect(verifyPaddleSignature(body + "tampered", header, secret)).toBe(false);
  });

  test("rejects a signature made with the wrong secret", () => {
    const body = JSON.stringify({ event_type: "subscription.created" });
    const header = signedHeader(body, "1700000000", "whsec_other_secret");
    expect(verifyPaddleSignature(body, header, secret)).toBe(false);
  });

  test("rejects a missing header", () => {
    expect(verifyPaddleSignature("{}", null, secret)).toBe(false);
  });

  test("rejects a malformed header", () => {
    expect(verifyPaddleSignature("{}", "not-a-valid-header", secret)).toBe(false);
  });
});

type Terminal = { data: unknown; error: unknown };

function fakeChain(terminal: Terminal, onWrite?: (payload: unknown) => void) {
  const chain = {
    select: (..._args: unknown[]) => chain,
    eq: (..._args: unknown[]) => chain,
    is: (..._args: unknown[]) => chain,
    update: (payload: unknown) => {
      onWrite?.(payload);
      return chain;
    },
    upsert: (payload: unknown) => {
      onWrite?.(payload);
      return chain;
    },
    maybeSingle: async () => terminal,
    then: (resolve: (v: Terminal) => void) => resolve(terminal),
  };
  return chain;
}

function fakeDb(config: { plan: Terminal; existingSubscription?: Terminal }) {
  const subscriptionUpserts: unknown[] = [];
  const profileUpdates: unknown[] = [];
  const entitlementUpdates: unknown[] = [];
  let subscriptionsCallCount = 0;

  const from = mock((table: string) => {
    if (table === "subscription_plans") return fakeChain(config.plan);
    if (table === "subscriptions") {
      subscriptionsCallCount += 1;
      if (subscriptionsCallCount === 1) {
        return fakeChain(config.existingSubscription ?? { data: null, error: null });
      }
      return fakeChain({ data: null, error: null }, (p) => subscriptionUpserts.push(p));
    }
    if (table === "profiles") {
      return fakeChain({ data: null, error: null }, (p) => profileUpdates.push(p));
    }
    if (table === "user_entitlements") {
      return fakeChain({ data: null, error: null }, (p) => entitlementUpdates.push(p));
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { db: { from } as never, subscriptionUpserts, profileUpdates, entitlementUpdates };
}

function baseEvent(overrides: Partial<PaddleSubscriptionWebhookEvent["data"]>): PaddleSubscriptionWebhookEvent {
  return {
    event_type: "subscription.created",
    data: {
      id: "sub_123",
      customer_id: "ctm_123",
      status: "active",
      current_billing_period: { ends_at: "2026-08-24T00:00:00Z" },
      scheduled_change: null,
      items: [{ price: { id: "pri_starter" } }],
      custom_data: { user_id: "user-1" },
      ...overrides,
    },
  };
}

describe("applyPaddleSubscriptionEvent", () => {
  test("grants entitlements and sets initial credits for a new active subscription", async () => {
    const { db, subscriptionUpserts, entitlementUpdates } = fakeDb({
      plan: { data: { id: "plan-1", credits_included: 500 }, error: null },
      existingSubscription: { data: null, error: null },
    });
    await applyPaddleSubscriptionEvent(db, baseEvent({}));

    expect(subscriptionUpserts).toEqual([
      {
        user_id: "user-1",
        plan_id: "plan-1",
        paddle_subscription_id: "sub_123",
        paddle_customer_id: "ctm_123",
        status: "active",
        current_period_end: "2026-08-24T00:00:00Z",
        cancel_at_period_end: false,
      },
    ]);
    expect(entitlementUpdates).toEqual([{ ads_removed: true, ai_credits: 500 }]);
  });

  test("refills credits only when the billing period actually advances", async () => {
    const { db, entitlementUpdates } = fakeDb({
      plan: { data: { id: "plan-1", credits_included: 500 }, error: null },
      existingSubscription: { data: { current_period_end: "2026-07-24T00:00:00Z" }, error: null },
    });
    await applyPaddleSubscriptionEvent(
      db,
      baseEvent({ current_billing_period: { ends_at: "2026-07-24T00:00:00Z" } }),
    );

    expect(entitlementUpdates).toEqual([{ ads_removed: true }]);
  });

  test("revokes ads_removed without clawing back credits on cancellation", async () => {
    const { db, entitlementUpdates } = fakeDb({
      plan: { data: { id: "plan-1", credits_included: 500 }, error: null },
      existingSubscription: { data: { current_period_end: "2026-08-24T00:00:00Z" }, error: null },
    });
    await applyPaddleSubscriptionEvent(db, baseEvent({ status: "canceled", current_billing_period: null }));

    expect(entitlementUpdates).toEqual([{ ads_removed: false }]);
  });

  test("keeps access during past_due (dunning grace period)", async () => {
    const { db, entitlementUpdates } = fakeDb({
      plan: { data: { id: "plan-1", credits_included: 500 }, error: null },
      existingSubscription: { data: { current_period_end: "2026-08-24T00:00:00Z" }, error: null },
    });
    await applyPaddleSubscriptionEvent(
      db,
      baseEvent({ status: "past_due", current_billing_period: { ends_at: "2026-08-24T00:00:00Z" } }),
    );

    expect(entitlementUpdates).toEqual([{ ads_removed: true }]);
  });

  test("skips processing when custom_data.user_id is missing", async () => {
    const { db, subscriptionUpserts, entitlementUpdates } = fakeDb({
      plan: { data: { id: "plan-1", credits_included: 500 }, error: null },
    });
    await applyPaddleSubscriptionEvent(db, baseEvent({ custom_data: null }));

    expect(subscriptionUpserts).toEqual([]);
    expect(entitlementUpdates).toEqual([]);
  });

  test("skips processing when the price id doesn't match a known plan", async () => {
    const { db, subscriptionUpserts, entitlementUpdates } = fakeDb({
      plan: { data: null, error: null },
    });
    await applyPaddleSubscriptionEvent(db, baseEvent({}));

    expect(subscriptionUpserts).toEqual([]);
    expect(entitlementUpdates).toEqual([]);
  });
});
