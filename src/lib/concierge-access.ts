export interface ConciergeAccess {
  headline: string;
  caption: string;
}

/**
 * What the Concierge Access line on the account page says. The concierge spends
 * credits, so a member can use it with a plan or with credits in hand — and a
 * free member with neither is told it is for members rather than that they have
 * it. `credits` is null until the balance has loaded.
 */
export function conciergeAccess(input: {
  hasPlan: boolean;
  credits: number | null;
}): ConciergeAccess {
  if (input.hasPlan) return { headline: "Included", caption: "With your plan" };
  if ((input.credits ?? 0) > 0) return { headline: "On credits", caption: "While they last" };
  return { headline: "Members only", caption: "Not on the Free tier" };
}
