/**
 * Codes a generation answer can carry that a client must recognise. A leaf
 * module with no imports, so web code can match them without pulling in any
 * server module; the server's errors use these same constants.
 */

/**
 * A replayed generation that was made (and charged) but could not be stored:
 * there is nothing to show again. Never a failure to retry with a new request
 * id, which would be a new, charged generation. `/api/v1` answers it as
 * `409 DELIVERED_NOT_SAVED`.
 */
export const DELIVERED_NOT_SAVED = "DELIVERED_NOT_SAVED" as const;

/** What she is told: true whether she saw the result or its answer was lost. */
export const DELIVERED_NOT_SAVED_MESSAGE =
  "This result was made, but it couldn't be saved, so it can't be shown again. You won't be charged again for it.";

/**
 * Structural match for a thrown error or an `/api/v1` error body carrying the
 * code. A web server function may surface only the message, so the exact
 * message matches too.
 */
export function isDeliveredNotSaved(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === DELIVERED_NOT_SAVED || message === DELIVERED_NOT_SAVED_MESSAGE;
}
