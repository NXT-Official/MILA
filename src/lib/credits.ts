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
