import { describe, expect, test } from "bun:test";
import {
  IN_FORCE_SUBSCRIPTION_STATUSES,
  isStaffGrantedSubscription,
  isSubscriptionLive,
} from "./subscriptions";

const NOW = new Date("2026-09-30T06:00:00Z");

describe("isSubscriptionLive", () => {
  test("an active subscription inside its paid period is live", () => {
    expect(
      isSubscriptionLive(
        {
          status: "active",
          current_period_end: "2026-10-24T00:00:00Z",
          cancel_at_period_end: false,
        },
        NOW,
      ),
    ).toBe(true);
  });

  test("past_due stays live: Paddle is still retrying the payment", () => {
    expect(
      isSubscriptionLive(
        {
          status: "past_due",
          current_period_end: "2026-10-24T00:00:00Z",
          cancel_at_period_end: false,
        },
        NOW,
      ),
    ).toBe(true);
  });

  test("a cancelled subscription keeps its access until the period ends", () => {
    expect(
      isSubscriptionLive(
        {
          status: "active",
          current_period_end: "2026-10-24T00:00:00Z",
          cancel_at_period_end: true,
        },
        NOW,
      ),
    ).toBe(true);
  });

  test("a cancelled subscription past its period end is over", () => {
    expect(
      isSubscriptionLive(
        {
          status: "active",
          current_period_end: "2026-09-24T00:00:00Z",
          cancel_at_period_end: true,
        },
        NOW,
      ),
    ).toBe(false);
  });

  test("a renewing subscription past its period end stays live until the sweep settles it", () => {
    expect(
      isSubscriptionLive(
        {
          status: "active",
          current_period_end: "2026-09-24T00:00:00Z",
          cancel_at_period_end: false,
        },
        NOW,
      ),
    ).toBe(true);
  });

  test("statuses outside the in-force list are never live", () => {
    for (const status of ["canceled", "paused", "unknown"]) {
      expect(IN_FORCE_SUBSCRIPTION_STATUSES.includes(status)).toBe(false);
      expect(
        isSubscriptionLive({ status, current_period_end: null, cancel_at_period_end: false }, NOW),
      ).toBe(false);
    }
  });

  test("a plan staff granted by hand never expires on its own", () => {
    expect(
      isSubscriptionLive(
        { status: "active", current_period_end: null, cancel_at_period_end: false },
        NOW,
      ),
    ).toBe(true);
  });

  test("an unparseable period end is not treated as expired", () => {
    expect(
      isSubscriptionLive(
        { status: "active", current_period_end: "not-a-date", cancel_at_period_end: true },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("isStaffGrantedSubscription", () => {
  test("recognizes the manual: prefix and nothing else", () => {
    expect(isStaffGrantedSubscription("manual:1234")).toBe(true);
    expect(isStaffGrantedSubscription("sub_1234")).toBe(false);
    expect(isStaffGrantedSubscription(null)).toBe(false);
    expect(isStaffGrantedSubscription(undefined)).toBe(false);
  });

  test("a granted row created by hand in the database counts too", () => {
    expect(isStaffGrantedSubscription("manual_comp_b0f0a34a-a32c-4b3c-95d5-5c6a81fe39ea")).toBe(
      true,
    );
  });
});
