import { isMemberSessionUnavailable } from "@/lib/auth-session";

/**
 * Retry policy for queries that read the member's own data.
 *
 * Any other error keeps React Query's default (3 retries in the browser,
 * none on the server; query-core 5.101.2 src/retryer.ts:170).
 *
 * While her session is unavailable (`memberAuthorization` threw because the
 * token refresh is failing), keep retrying with the default capped backoff
 * (1 s, 2 s, 4 s … 30 s; retryer.ts:49-51) for about 14 minutes. During
 * retries the query keeps its last good data and is not in the error state,
 * so screens keep showing her real numbers instead of "0" or a dash.
 * // src: node_modules/@tanstack/query-core/src/retryer.ts · 5.101.2
 */
export const MEMBER_SESSION_RETRIES = 30;

export function memberQueryRetry(failureCount: number, error: unknown): boolean {
  if (isMemberSessionUnavailable(error)) return failureCount < MEMBER_SESSION_RETRIES;
  if (typeof window === "undefined") return false;
  return failureCount < 3;
}
