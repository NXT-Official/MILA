import { redirect } from "@tanstack/react-router";
import { readSession, type AuthClientLike, type SessionRead } from "@/lib/auth-session";
import { loginRedirectSearch } from "@/lib/safe-redirect";

/**
 * `beforeLoad` check for every signed-in page.
 *
 * - Signed in: carry on.
 * - Signed out (no stored session, or the server rejected the refresh token):
 *   go to /login, carrying the page she was on so sign-in brings her back.
 * - Unreachable (network or 5xx while refreshing an expired access token): do
 *   NOT redirect. auth-js keeps the stored session for a retryable failure, so
 *   she is still signed in; the layout shows "Reconnecting" and the auth
 *   provider keeps retrying until the refresh lands.
 *
 * Retrying inside beforeLoad would buy nothing: `getSession()` already retried
 * the refresh with exponential backoff for up to one 30 s tick
 * (`_refreshAccessToken` → `retryable(...)`), and a failed refresh is then
 * cached for 60 s per refresh token (`REFRESH_FAILURE_COOLDOWN_MS`).
 * // src: node_modules/@supabase/auth-js/src/GoTrueClient.ts (`__loadSession`,
 * //      `_callRefreshToken`, `_refreshAccessToken`) · 2.110.0
 */
export async function requireSignedIn(
  auth: Pick<AuthClientLike, "getSession">,
  location: { href: string },
): Promise<SessionRead> {
  const read = await readSession(auth);
  if (read.kind === "signed-out") {
    throw redirect({ to: "/login", search: loginRedirectSearch(location.href) });
  }
  return read;
}
