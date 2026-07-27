// The message text doubles as the match sentinel for isInsufficientCreditsError.
// Necessary because these errors cross a TanStack Start server-fn boundary:
// its ShallowErrorPlugin serializes only Error.message (a deliberate choice —
// see node_modules/@tanstack/router-core/.../ShallowErrorPlugin.js — so errors
// like ZodError with unserializable attached functions still round-trip).
// Error.name is always reset to the generic "Error" on the client, so a
// name-based check silently never matches for server-thrown errors.
export const INSUFFICIENT_CREDITS = "You're out of styling credits for today.";

// Free-tier daily allowance. Zero by design: credits come from a subscription
// plan (subscription_plans.credits_included) or a purchased pack, never from
// signing up. consume_ai_credit resets the balance to this every day, so this
// constant — not the column default — is what actually decides what a
// non-subscriber gets.
export const DEFAULT_AI_CREDITS = 0;

export class InsufficientCreditsError extends Error {
  constructor() {
    super(INSUFFICIENT_CREDITS);
  }
}

export function isInsufficientCreditsError(err: unknown): boolean {
  return err instanceof Error && err.message === INSUFFICIENT_CREDITS;
}
