export const IN_FORCE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];

/**
 * A plan staff granted by hand: a local subscription row with synthetic ids and
 * no Paddle subscription behind it. The admin console writes `manual:<uuid>`,
 * but rows created by hand in the database (`manual_comp_…`) count too — Paddle's
 * own ids always start with `sub_`, so nothing billed can carry this prefix.
 * It is how the member app tells a granted plan from a bought one — self-serve
 * cancel/resume must not call Paddle for it.
 */
export const STAFF_GRANTED_SUBSCRIPTION_PREFIX = "manual";

export function isStaffGrantedSubscription(
  paddleSubscriptionId: string | null | undefined,
): boolean {
  return (
    typeof paddleSubscriptionId === "string" &&
    paddleSubscriptionId.startsWith(STAFF_GRANTED_SUBSCRIPTION_PREFIX)
  );
}

/** What the member is told when a granted plan can't be changed from the app. */
export const STAFF_GRANTED_SUBSCRIPTION_NOTICE =
  "This membership was granted by the Mila team, so it isn't billed through Paddle. Contact the help desk to change or end it.";

/**
 * Whether a subscription still entitles the member right now. Status alone
 * isn't enough: a plan cancelled to run out at the end of its paid period keeps
 * `active` in the database until Paddle's webhook (or the daily sweep) catches
 * up, so an ended paid period must not read as a live membership. A plan staff
 * granted by hand has no period end and never expires this way — only staff end
 * it.
 */
export function isSubscriptionLive(
  subscription: {
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean | null;
  },
  now: Date = new Date(),
): boolean {
  if (!IN_FORCE_SUBSCRIPTION_STATUSES.includes(subscription.status)) return false;
  if (!subscription.cancel_at_period_end) return true;
  if (!subscription.current_period_end) return true;
  const end = Date.parse(subscription.current_period_end);
  return Number.isNaN(end) || end > now.getTime();
}
