/**
 * Typed errors thrown by the `src/server/services/*.ts` layer that `/api/v1/*`
 * file-route handlers know how to map to the mobile error taxonomy (see
 * `respond.ts`). These are additive to the errors that already existed in the
 * shared `*.functions.ts` logic (`InsufficientCreditsError`,
 * `RateLimitExceededError`, `ZodError`, `UnauthorizedError`, `SuspendedError`)
 * — this file only introduces the handful of cases those didn't already
 * distinguish.
 */

/**
 * A caller-facing, non-retryable input/business-rule problem — a missing
 * record, a mismatched confirmation value, a link that failed validation.
 * Maps to `400 VALIDATION_FAILED`. The message is shown to the member, so it
 * must never contain raw database or provider error text.
 */
export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

/**
 * The AI provider failed, timed out, or returned something unusable. Maps to
 * `503 AI_UNAVAILABLE` — the mobile client shows a "try again" affordance
 * rather than treating it as fatal.
 */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/**
 * The caller is authenticated and in good standing, but is not allowed to
 * perform this specific action (distinct from `SuspendedError`, which is
 * account-wide). Maps to `403 FORBIDDEN`.
 */
export class ForbiddenServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenServiceError";
  }
}

/**
 * An upstream dependency (Paddle, hCaptcha, a storage signing call) refused
 * or errored in a way that isn't the caller's fault and isn't an AI call.
 * Maps to `503 AI_UNAVAILABLE` as well — the mobile taxonomy has no separate
 * "upstream unavailable" bucket for `/api/v1`, and the retry semantics are
 * identical (try again shortly).
 */
export class UpstreamUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamUnavailableError";
  }
}
