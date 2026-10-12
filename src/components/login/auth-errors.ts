import { TimeoutError, errorMessage, isStaleBundleError } from "@/lib/utils";

/**
 * What the sign-up handler throws for EVERY provider refusal: an address that
 * is already registered, a failed captcha, a rate limit, an outage. It is
 * deliberately one string (src/lib/auth-handler.server.ts) so the response
 * never tells a stranger whether an account exists. auth-errors.test.ts drives
 * the real handler, so this constant cannot drift from it unnoticed.
 */
const SIGNUP_REFUSED_BY_SERVER = "Unable to create the account. Please try again later.";

/**
 * The same wording for every refusal. It does not say whether the address is
 * registered, so it cannot be used to find out; it still tells a returning
 * member where to go.
 */
export const SIGNUP_FAILED_COPY =
  "We couldn't create that account. If you already have one, log in or reset your password. If not, please try again in a moment.";

export const SIGNUP_NETWORK_COPY = "We couldn't reach Mila. Check your connection and try again.";

export const SIGNUP_UPDATED_COPY = "Mila was just updated. Refresh the page and try again.";

// What fetch() rejects with when nothing answered: Chrome "Failed to fetch",
// Firefox "NetworkError when attempting to fetch resource.", Safari "Load
// failed", Node "fetch failed".
// src: https://fetch.spec.whatwg.org/#concept-network-error · rejects with a TypeError
const NETWORK_FAILURE =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed/i;

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TimeoutError || NETWORK_FAILURE.test(errorMessage(error, ""));
}

/**
 * The sentence a member reads when creating an account fails. Always one of
 * three written lines, never the error's own text: a raw message can be a
 * database error or a validation dump, and must not reach the screen.
 */
export function signupFailureMessage(error: unknown): string {
  if (errorMessage(error, "") === SIGNUP_REFUSED_BY_SERVER) return SIGNUP_FAILED_COPY;
  if (isStaleBundleError(error)) return SIGNUP_UPDATED_COPY;
  if (isNetworkFailure(error)) return SIGNUP_NETWORK_COPY;
  return SIGNUP_FAILED_COPY;
}
