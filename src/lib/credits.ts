/**
 * Client-safe helpers for the AI credit ledger. The server function throws
 * `Error("INSUFFICIENT_CREDITS")` when the user's `ai_credits` balance is 0;
 * TanStack Start surfaces that message inside the rejected promise.
 */
export const INSUFFICIENT_CREDITS = "INSUFFICIENT_CREDITS";

export function isInsufficientCreditsError(err: unknown): boolean {
  // TODO: Re-enable premium gate before production launch
  // Demo/preview mode: never treat anything as an insufficient-credits
  // error so the upgrade paywall never fires.
  void err;
  return false;
}