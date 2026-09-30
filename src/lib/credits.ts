export const INSUFFICIENT_CREDITS = "You're out of styling credits for today.";
export const DEFAULT_AI_CREDITS = 0;

export class InsufficientCreditsError extends Error {
  constructor() {
    super(INSUFFICIENT_CREDITS);
  }
}

export function isInsufficientCreditsError(err: unknown): boolean {
  return err instanceof Error && err.message === INSUFFICIENT_CREDITS;
}

/**
 * The credit RPCs bucket the daily allowance by UTC calendar date
 * (`consume_ai_credit` compares `credits_reset_at` with `CURRENT_DATE`), so
 * anything reading a balance has to use the same clock.
 */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * What the member can spend today. `ai_credits` only holds today's bucket once
 * the day has been reset — on the first use, or by the daily sweep — so until
 * then the live plan's allowance is what they are owed, and no plan means
 * nothing is owed. Purchased credits are the member's own and always count.
 */
export function effectiveCredits(input: {
  aiCredits: number;
  purchasedCredits: number;
  creditsResetAt: string | null;
  planAllowance: number | null;
  today: string;
}): number {
  const daily = input.creditsResetAt === input.today ? input.aiCredits : (input.planAllowance ?? 0);
  return daily + input.purchasedCredits;
}
