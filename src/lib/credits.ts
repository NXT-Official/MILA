export const INSUFFICIENT_CREDITS = "INSUFFICIENT_CREDITS";

export const DEFAULT_AI_CREDITS = 5;

export class InsufficientCreditsError extends Error {
  constructor() {
    super("You're out of styling credits for today.");
    this.name = INSUFFICIENT_CREDITS;
  }
}

export function isInsufficientCreditsError(err: unknown): boolean {
  return err instanceof Error && err.name === INSUFFICIENT_CREDITS;
}
