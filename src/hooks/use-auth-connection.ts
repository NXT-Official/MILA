import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  isSessionUnavailable,
  sessionCameBack,
  subscribeSessionUnavailable,
  type AuthStatus,
  type SessionReadiness,
} from "@/lib/auth-session";

/**
 * Where the session stands, beyond signed in or out: "reconnecting" means the
 * stored session could not be refreshed because the network or the auth server
 * is down. She is still signed in; nothing may send her to /login for it.
 */
export interface AuthConnection {
  status: AuthStatus;
  /** Try to reach the auth server again now (only acts while reconnecting). */
  retryNow: () => void;
  /**
   * Force a real token refresh now, skipping auth-js's 60 s failure cache.
   * Every Try again calls it before re-running its own read.
   */
  refreshNow: () => void;
}

export const AuthConnectionContext = createContext<AuthConnection>({
  status: "loading",
  retryNow: () => {},
  refreshNow: () => {},
});

export function useAuthConnection(): AuthConnection {
  return useContext(AuthConnectionContext);
}

/**
 * Every page-level Try again first forces a real token refresh (her read may
 * have failed only because the session is reconnecting, and auth-js would
 * otherwise answer from its 60 s failure cache), then re-runs the page's own
 * read (R-4).
 */
export function runReconnectRetry(
  connection: Pick<AuthConnection, "refreshNow">,
  onRetry: () => void,
): void {
  connection.refreshNow();
  onRetry();
}

const getServerUnavailable = () => false;

/**
 * Runs `retry` by itself once her session is back after a read failed (R-4):
 * the Reconnecting note's Try again, or auth-js's own refresh, landed a new
 * token or ended the note. So a page that showed its own try-again state
 * recovers with no second tap. Only while `failed`; never while the note is
 * still up.
 */
export function useRetryWhenSessionReturns(failed: boolean, retry: () => void): void {
  const { session } = useAuth();
  const unavailable = useSyncExternalStore(
    subscribeSessionUnavailable,
    isSessionUnavailable,
    getServerUnavailable,
  );
  const accessToken = session?.access_token ?? null;
  const before = useRef<SessionReadiness>({ accessToken, unavailable });
  const latest = useRef({ failed, retry });
  useEffect(() => {
    latest.current = { failed, retry };
  });
  useEffect(() => {
    const now: SessionReadiness = { accessToken, unavailable };
    const previous = before.current;
    before.current = now;
    if (latest.current.failed && sessionCameBack(previous, now)) latest.current.retry();
  }, [accessToken, unavailable]);
}
