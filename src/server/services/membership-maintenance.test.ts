import { describe, expect, mock, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  classifyStaleSubscriptions,
  planTopUpGroups,
  runMembershipMaintenance,
  utcDate,
  type MaintenanceSubscription,
} from "./membership-maintenance";

const TODAY = new Date("2026-09-30T06:00:00Z");

function subscription(overrides: Partial<MaintenanceSubscription> = {}): MaintenanceSubscription {
  return {
    user_id: "user-1",
    plan_id: "plan-1",
    status: "active",
    paddle_subscription_id: "sub_1",
    current_period_end: "2026-10-24T00:00:00Z",
    cancel_at_period_end: false,
    ...overrides,
  };
}

describe("utcDate", () => {
  test("uses the same clock as consume_ai_credit's CURRENT_DATE", () => {
    expect(utcDate(new Date("2026-09-30T23:59:59Z"))).toBe("2026-09-30");
    expect(utcDate(new Date("2026-10-01T00:00:01Z"))).toBe("2026-10-01");
  });
});

describe("classifyStaleSubscriptions", () => {
  test("leaves a subscription whose paid period is still running alone", () => {
    expect(classifyStaleSubscriptions([subscription()], TODAY)).toEqual([]);
  });

  test("a granted plan has no period end and never goes stale", () => {
    const granted = subscription({
      paddle_subscription_id: "manual:abc",
      current_period_end: null,
      cancel_at_period_end: false,
    });
    expect(classifyStaleSubscriptions([granted], TODAY)).toEqual([]);
  });

  test("a cancelled subscription past its period end is over", () => {
    const ended = subscription({
      cancel_at_period_end: true,
      current_period_end: "2026-09-24T00:00:00Z",
    });
    const [stale] = classifyStaleSubscriptions([ended], TODAY);
    expect(stale.kind).toBe("ended");
  });

  test("a renewing subscription past its period end is reconciled instead", () => {
    const stale = subscription({ current_period_end: "2026-09-24T00:00:00Z" });
    const [item] = classifyStaleSubscriptions([stale], TODAY);
    expect(item.kind).toBe("reconcile");
  });
});

describe("planTopUpGroups", () => {
  test("groups members by the allowance they are owed", () => {
    const groups = planTopUpGroups(
      [
        subscription({ user_id: "a", plan_id: "plan-1" }),
        subscription({ user_id: "b", plan_id: "plan-2" }),
        subscription({ user_id: "c", plan_id: "plan-1" }),
      ],
      new Map([
        ["plan-1", 30],
        ["plan-2", 120],
      ]),
    );

    expect(groups).toEqual([
      { credits: 30, userIds: ["a", "c"] },
      { credits: 120, userIds: ["b"] },
    ]);
  });

  test("a member with two live rows keeps the best allowance, once", () => {
    const groups = planTopUpGroups(
      [
        subscription({ user_id: "a", plan_id: "plan-1" }),
        subscription({ user_id: "a", plan_id: "plan-2" }),
      ],
      new Map([
        ["plan-1", 30],
        ["plan-2", 120],
      ]),
    );

    expect(groups).toEqual([{ credits: 120, userIds: ["a"] }]);
  });

  test("skips rows whose plan is gone rather than granting zero", () => {
    const groups = planTopUpGroups(
      [subscription({ user_id: "a", plan_id: "missing" })],
      new Map([["plan-1", 30]]),
    );
    expect(groups).toEqual([]);
  });
});

type SubRow = MaintenanceSubscription;
type EntitlementRow = { user_id: string; credits_reset_at: string | null };

function fakeDb(config: {
  subs: SubRow[];
  entitlements?: EntitlementRow[];
  plans?: { id: string; credits_included: number }[];
}) {
  const subs = config.subs.map((row) => ({ ...row }));
  const entitlements = (config.entitlements ?? []).map((row) => ({ ...row }));
  const plans = config.plans ?? [];
  const entitlementUpdates: { payload: Record<string, unknown>; userIds: string[] }[] = [];
  const subscriptionUpdates: { payload: Record<string, unknown>; id: string }[] = [];

  const db = {
    from(table: string) {
      return {
        select: () => ({
          in: async (_column: string, values: string[]) => {
            if (table === "subscriptions") {
              return { data: subs.filter((row) => values.includes(row.status)), error: null };
            }
            if (table === "subscription_plans") {
              return { data: plans.filter((plan) => values.includes(plan.id)), error: null };
            }
            if (table === "user_entitlements") {
              return {
                data: entitlements.filter((row) => values.includes(row.user_id)),
                error: null,
              };
            }
            throw new Error(`unexpected select on ${table}`);
          },
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: async (column: string, value: string) => {
            if (table !== "subscriptions") throw new Error(`unexpected eq update on ${table}`);
            const row = subs.find((candidate) => candidate.paddle_subscription_id === value);
            if (row) Object.assign(row, payload);
            subscriptionUpdates.push({ payload, id: value });
            return { error: null };
          },
          in: async (_column: string, values: string[]) => {
            if (table !== "user_entitlements") throw new Error(`unexpected in update on ${table}`);
            entitlementUpdates.push({ payload, userIds: values });
            for (const row of entitlements) {
              if (values.includes(row.user_id)) Object.assign(row, payload);
            }
            return { error: null };
          },
        }),
      };
    },
  } as unknown as SupabaseClient<Database>;

  return { db, subs, entitlements, entitlementUpdates, subscriptionUpdates };
}

describe("runMembershipMaintenance", () => {
  test("gives a live subscriber today's allowance", async () => {
    const { db, entitlementUpdates } = fakeDb({
      subs: [subscription()],
      entitlements: [{ user_id: "user-1", credits_reset_at: "2026-09-29" }],
      plans: [{ id: "plan-1", credits_included: 30 }],
    });

    const summary = await runMembershipMaintenance({ db, now: () => TODAY });

    expect(summary).toMatchObject({ date: "2026-09-30", live: 1, toppedUp: 1, ended: 0 });
    expect(entitlementUpdates).toEqual([
      { payload: { ai_credits: 30, credits_reset_at: "2026-09-30" }, userIds: ["user-1"] },
    ]);
  });

  test("is idempotent: a member who already has today's bucket is left alone", async () => {
    const { db, entitlementUpdates } = fakeDb({
      subs: [subscription()],
      entitlements: [{ user_id: "user-1", credits_reset_at: "2026-09-30" }],
      plans: [{ id: "plan-1", credits_included: 30 }],
    });

    const summary = await runMembershipMaintenance({ db, now: () => TODAY });

    expect(summary.toppedUp).toBe(0);
    expect(entitlementUpdates).toEqual([]);
  });

  test("ends a cancelled subscription whose period ran out, and pays it nothing", async () => {
    const { db, entitlementUpdates, subscriptionUpdates } = fakeDb({
      subs: [
        subscription({
          user_id: "gone",
          paddle_subscription_id: "sub_gone",
          cancel_at_period_end: true,
          current_period_end: "2026-09-24T00:00:00Z",
        }),
      ],
      entitlements: [{ user_id: "gone", credits_reset_at: "2026-09-23" }],
      plans: [{ id: "plan-1", credits_included: 30 }],
    });

    const summary = await runMembershipMaintenance({ db, now: () => TODAY });

    expect(subscriptionUpdates).toEqual([
      { payload: { status: "canceled", cancel_at_period_end: false }, id: "sub_gone" },
    ]);
    expect(summary).toMatchObject({ ended: 1, live: 0, toppedUp: 0 });
    expect(entitlementUpdates).toEqual([]);
  });

  test("reconciles a renewing subscription past its period against Paddle", async () => {
    const { db } = fakeDb({
      subs: [
        subscription({
          user_id: "renewer",
          paddle_subscription_id: "sub_renew",
          current_period_end: "2026-09-24T00:00:00Z",
        }),
      ],
      entitlements: [{ user_id: "renewer", credits_reset_at: "2026-09-24" }],
      plans: [{ id: "plan-1", credits_included: 30 }],
    });
    const applySubscriptionEvent = mock(async () => {});
    const fetchSubscription = mock(async () => ({
      id: "sub_renew",
      customer_id: "ctm_1",
      status: "active",
      current_billing_period: { ends_at: "2026-10-24T00:00:00Z" },
      scheduled_change: null,
      items: [{ price: { id: "pri_1" } }],
      custom_data: { user_id: "renewer" },
    }));

    const summary = await runMembershipMaintenance({
      db,
      now: () => TODAY,
      fetchSubscription,
      applySubscriptionEvent,
    });

    expect(fetchSubscription).toHaveBeenCalledWith("sub_renew");
    expect(applySubscriptionEvent).toHaveBeenCalledTimes(1);
    expect(summary.reconciled).toBe(1);
  });

  test("keeps a renewing row and still pays it when Paddle can't be reached", async () => {
    const { db, entitlementUpdates } = fakeDb({
      subs: [
        subscription({
          user_id: "renewer",
          paddle_subscription_id: "sub_renew",
          current_period_end: "2026-09-24T00:00:00Z",
        }),
      ],
      entitlements: [{ user_id: "renewer", credits_reset_at: "2026-09-24" }],
      plans: [{ id: "plan-1", credits_included: 30 }],
    });

    const summary = await runMembershipMaintenance({
      db,
      now: () => TODAY,
      fetchSubscription: async () => null,
    });

    expect(summary).toMatchObject({ skipped: 1, toppedUp: 1 });
    expect(entitlementUpdates).toEqual([
      { payload: { ai_credits: 30, credits_reset_at: "2026-09-30" }, userIds: ["renewer"] },
    ]);
  });

  test("never asks Paddle about a granted plan, even past its period end", async () => {
    const { db, subscriptionUpdates } = fakeDb({
      subs: [
        subscription({
          user_id: "comped",
          paddle_subscription_id: "manual_comp_1234",
          current_period_end: "2026-09-24T00:00:00Z",
        }),
      ],
      entitlements: [{ user_id: "comped", credits_reset_at: "2026-09-24" }],
      plans: [{ id: "plan-1", credits_included: 30 }],
    });
    const fetchSubscription = mock(async () => null);

    const summary = await runMembershipMaintenance({
      db,
      now: () => TODAY,
      fetchSubscription,
    });

    expect(fetchSubscription).not.toHaveBeenCalled();
    expect(subscriptionUpdates).toEqual([]);
    expect(summary).toMatchObject({ skipped: 1, toppedUp: 1 });
  });

  test("reports a Paddle failure without aborting the rest of the sweep", async () => {
    const { db } = fakeDb({
      subs: [
        subscription({
          user_id: "renewer",
          paddle_subscription_id: "sub_renew",
          current_period_end: "2026-09-24T00:00:00Z",
        }),
        subscription({ user_id: "user-1", paddle_subscription_id: "sub_1" }),
      ],
      entitlements: [
        { user_id: "renewer", credits_reset_at: "2026-09-24" },
        { user_id: "user-1", credits_reset_at: "2026-09-24" },
      ],
      plans: [{ id: "plan-1", credits_included: 30 }],
    });

    const summary = await runMembershipMaintenance({
      db,
      now: () => TODAY,
      fetchSubscription: async () => {
        throw new Error("Paddle lookup failed");
      },
    });

    expect(summary.errors).toEqual(["reconcile sub_renew: Paddle lookup failed"]);
    // Both members keep today's allowance: one is plainly live, the other is a
    // renewing row we couldn't verify — Paddle being down is not the member's
    // fault, so it is not downgraded on a guess.
    expect(summary.toppedUp).toBe(2);
  });

  test("does nothing at all when nobody is subscribed", async () => {
    const { db, entitlementUpdates, subscriptionUpdates } = fakeDb({ subs: [] });

    const summary = await runMembershipMaintenance({ db, now: () => TODAY });

    expect(summary).toMatchObject({ live: 0, toppedUp: 0, ended: 0, reconciled: 0 });
    expect(entitlementUpdates).toEqual([]);
    expect(subscriptionUpdates).toEqual([]);
  });
});
