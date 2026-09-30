export const IN_FORCE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];

/**
 * A plan staff granted by hand from the admin console: a local subscription row
 * with synthetic ids (`manual:<uuid>`) and no Paddle subscription behind it.
 * Nothing billed through Paddle can carry that prefix, so it is how the member
 * app tells a granted plan from a bought one — self-serve cancel/resume must not
 * call Paddle for it.
 */
export const STAFF_GRANTED_SUBSCRIPTION_PREFIX = "manual:";

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
