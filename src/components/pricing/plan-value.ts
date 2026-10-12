import type { PublicSubscriptionPlan } from "@/lib/subscription-plans";

/**
 * How plans compare, so the pricing badges say only what the numbers support.
 * A plan's `credits_included` is a daily allowance (`resolveDailyCreditAllowance`
 * in `src/lib/credits.server.ts`) and one credit composes one look with its
 * first visual (`generateLookForUser` in `src/server/services/look.ts`), so
 * looks a month is credits a day times the days in a month.
 */
const DAYS_PER_MONTH = 30;

type ComparablePlan = Pick<
  PublicSubscriptionPlan,
  "id" | "price_amount" | "currency" | "billing_interval" | "credits_included" | "is_featured"
>;

/** What the plan costs a month, in cents: a yearly price spread over twelve months. Null for a one-time purchase. */
export function monthlyEquivalentCents(plan: ComparablePlan): number | null {
  if (plan.billing_interval === "monthly") return plan.price_amount;
  if (plan.billing_interval === "yearly") return Math.round(plan.price_amount / 12);
  return null;
}

/** Looks per cent of the monthly price, unrounded; null when the plan can't be compared. */
function looksPerCent(plan: ComparablePlan): number | null {
  if (plan.billing_interval === "one_time") return null;
  if (plan.price_amount <= 0 || plan.credits_included <= 0) return null;
  const monthlyCents =
    plan.billing_interval === "yearly" ? plan.price_amount / 12 : plan.price_amount;
  return (plan.credits_included * DAYS_PER_MONTH) / monthlyCents;
}

/**
 * The plan that gives the most looks for its monthly price. Null when there is
 * no honest single answer: fewer than two paid recurring plans, prices in
 * different currencies, or a tie.
 */
export function bestValuePlanId(plans: ComparablePlan[]): string | null {
  const rated = plans
    .map((plan) => ({ plan, rate: looksPerCent(plan) }))
    .filter((entry): entry is { plan: ComparablePlan; rate: number } => entry.rate !== null);
  if (rated.length < 2) return null;
  if (new Set(rated.map(({ plan }) => plan.currency.toLowerCase())).size > 1) return null;

  const best = Math.max(...rated.map(({ rate }) => rate));
  const winners = rated.filter(({ rate }) => rate === best);
  return winners.length === 1 ? winners[0].plan.id : null;
}

export type PlanStanding = {
  label: "Recommended" | "Best value" | "Featured";
  basis: string | null;
};

/**
 * The badge a plan earns. A featured plan is "Recommended" only when it is
 * also the best value, and the card says why. A featured plan the numbers beat
 * keeps its highlight as "Featured", a label that claims nothing, and the plan
 * that does give the most looks for the price says so.
 */
export function planStanding(plan: ComparablePlan, plans: ComparablePlan[]): PlanStanding | null {
  const bestId = bestValuePlanId(plans);
  if (plan.id === bestId) {
    return plan.is_featured
      ? { label: "Recommended", basis: "Best value: the most looks for the price." }
      : { label: "Best value", basis: "The most looks for the price." };
  }
  return plan.is_featured ? { label: "Featured", basis: null } : null;
}
