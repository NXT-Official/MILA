export const INSUFFICIENT_CREDITS = "INSUFFICIENT_CREDITS";

export function isInsufficientCreditsError(err: unknown): boolean {
  // IN DEVELOPMENT [credit-enforcement]:
  // The paywall never triggers while consumeAiCredit doesn't deduct — kept
  // in lockstep with credits.server.ts.
  // See /IN_DEVELOPMENT.txt.
  void err;
  return false;
}
