import { describe, expect, test } from "bun:test";
import type { PublicSubscriptionPlan } from "@/lib/subscription-plans";
import { bestValuePlanId, monthlyEquivalentCents, planStanding } from "./plan-value";

function plan(overrides: Partial<PublicSubscriptionPlan> & { id: string }): PublicSubscriptionPlan {
  return {
    slug: overrides.id,
    title: overrides.id,
    description: "",
    price_amount: 1000,
    currency: "usd",
    billing_interval: "monthly",
    credits_included: 10,
    features: [],
    is_featured: false,
    paddle_price_id: `pri_${overrides.id}`,
    ...overrides,
  };
}

/** The live catalogue the UX audit judged: the featured monthly plan is not the best value. */
const STYLE_PRO = plan({
  id: "style-pro",
  price_amount: 1999,
  credits_included: 30,
  is_featured: true,
});
const ELITE = plan({
  id: "atelier-elite",
  price_amount: 14999,
  billing_interval: "yearly",
  credits_included: 100,
});
const MUSE = plan({ id: "muse", price_amount: 999, credits_included: 5 });

describe("monthlyEquivalentCents", () => {
  test("a monthly plan costs its price each month", () => {
    expect(monthlyEquivalentCents(STYLE_PRO)).toBe(1999);
  });

  test("a yearly plan costs a twelfth of its price each month, to the cent", () => {
    expect(monthlyEquivalentCents(ELITE)).toBe(1250);
    expect(
      monthlyEquivalentCents(plan({ id: "y", price_amount: 2400, billing_interval: "yearly" })),
    ).toBe(200);
  });

  test("a one-time purchase has no monthly price", () => {
    expect(monthlyEquivalentCents(plan({ id: "o", billing_interval: "one_time" }))).toBeNull();
  });
});

describe("bestValuePlanId: the most looks for the money", () => {
  test("picks the yearly plan that gives more looks for less a month", () => {
    expect(bestValuePlanId([MUSE, STYLE_PRO, ELITE])).toBe("atelier-elite");
  });

  test("with one comparable plan there is nothing to compare", () => {
    expect(bestValuePlanId([STYLE_PRO])).toBeNull();
  });

  test("a tie names no plan", () => {
    const a = plan({ id: "a", price_amount: 1000, credits_included: 10 });
    const b = plan({ id: "b", price_amount: 2000, credits_included: 20 });
    expect(bestValuePlanId([a, b])).toBeNull();
  });

  test("prices in different currencies are not compared", () => {
    expect(bestValuePlanId([STYLE_PRO, { ...ELITE, currency: "eur" }])).toBeNull();
  });

  test("free, creditless and one-time plans are left out of the comparison", () => {
    const free = plan({ id: "free", price_amount: 0, credits_included: 5 });
    const empty = plan({ id: "empty", price_amount: 100, credits_included: 0 });
    const pack = plan({
      id: "pack",
      price_amount: 100,
      credits_included: 50,
      billing_interval: "one_time",
    });
    expect(bestValuePlanId([free, empty, pack, MUSE, STYLE_PRO])).toBe("style-pro");
  });
});

describe("planStanding: the badge says only what the numbers support", () => {
  test("a featured plan that is the best value is recommended, and says why", () => {
    const featuredElite = { ...ELITE, is_featured: true };
    const plans = [MUSE, { ...STYLE_PRO, is_featured: false }, featuredElite];
    expect(planStanding(featuredElite, plans)).toEqual({
      label: "Recommended",
      basis: "Best value: the most looks for the price.",
    });
  });

  test("a featured plan the numbers beat loses the claim and is only featured", () => {
    const plans = [MUSE, STYLE_PRO, ELITE];
    expect(planStanding(STYLE_PRO, plans)).toEqual({ label: "Featured", basis: null });
    expect(planStanding(ELITE, plans)).toEqual({
      label: "Best value",
      basis: "The most looks for the price.",
    });
    expect(planStanding(MUSE, plans)).toBeNull();
  });

  test("with no comparison possible a featured plan is only featured", () => {
    expect(planStanding(STYLE_PRO, [STYLE_PRO])).toEqual({ label: "Featured", basis: null });
  });
});
