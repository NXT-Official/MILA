import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AuthContext } from "@/hooks/use-auth";
import { AuthConnectionContext } from "@/hooks/use-auth-connection";
import { identifyPhUser, resetPh } from "@/lib/posthog-client";
import {
  INITIAL_AUTH_SNAPSHOT,
  browserWake,
  clearSessionUnavailable,
  createAuthSessionStore,
  forgetCachedRefreshFailure,
  isSessionUnavailable,
  refreshSessionNow,
  signOutOrExplain,
  subscribeSessionUnavailable,
  type SignOutScope,
} from "@/lib/auth-session";
import { markAuthSettled } from "@/lib/landing-member-guard";
import { SessionNotice } from "@/components/layout/session-notice";

const getServerSnapshot = () => INITIAL_AUTH_SNAPSHOT;
const getServerUnavailable = () => false;

export function AuthProvider({ children }: { children: ReactNode }) {
  // The rules live in src/lib/auth-session.ts: one stable `user` object while
  // the member and her data are unchanged, and a network failure while
  // refreshing means "reconnecting", never "signed out".
  const [store] = useState(() =>
    createAuthSessionStore(() => supabase.auth, {
      onWake: browserWake,
      // Her "Try again" tap and the network coming back really reach the server.
      forceFreshAttempt: () => forgetCachedRefreshFailure(supabase.auth),
    }),
  );
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
  const [signingOut, setSigningOut] = useState(false);
  const previousUserId = useRef<string | null>(null);

  // PostHog person linking: identify the member once their session is known,
  // and clear the identity on sign-out so the next visitor starts fresh.
  // Keyed on the stable user id: "reconnecting" keeps the last user, so a
  // network blip never resets her identity.
  const userId = snapshot.user?.id ?? null;
  useEffect(() => {
    if (userId && userId !== previousUserId.current) {
      identifyPhUser(userId);
    } else if (!userId && previousUserId.current) {
      resetPh();
    }
    previousUserId.current = userId;
  }, [userId]);

  // Lets the landing's pre-paint style stand down once she is known to be
  // signed out or reconnecting (see landing-member-guard.ts).
  useEffect(() => {
    markAuthSettled(snapshot.status);
  }, [snapshot.status]);

  // Mid-session refresh failure (N-3): reads and saves are refused rather than
  // sent as anonymous, and a small note says so. A refreshed token, or a
  // sign-out, ends it.
  const sessionUnavailable = useSyncExternalStore(
    subscribeSessionUnavailable,
    isSessionUnavailable,
    getServerUnavailable,
  );
  const accessToken = snapshot.session?.access_token;
  useEffect(() => {
    clearSessionUnavailable();
  }, [accessToken]);
  useEffect(() => {
    if (snapshot.status === "signed-out") clearSessionUnavailable();
  }, [snapshot.status]);
  const retryMidSession = useCallback(() => {
    // A real attempt now, not auth-js's cached failure; success emits
    // TOKEN_REFRESHED, which clears the note and lets waiting queries retry.
    // A session read back with no event (another tab won the refresh race)
    // also ends it (R-3).
    void refreshSessionNow(supabase.auth);
  }, []);
  useEffect(() => {
    if (!sessionUnavailable) return;
    window.addEventListener("online", retryMidSession);
    return () => window.removeEventListener("online", retryMidSession);
  }, [sessionUnavailable, retryMidSession]);

  // This device only by default. Every current caller signs out of this
  // browser; account deletion already ends every session server side (the
  // auth user is deleted, and its sessions and refresh tokens go with it).
  // A sign-out that does not happen (offline, server error) is explained
  // calmly here, for every button, and never thrown.
  const signOut = useCallback(async (options?: { scope?: SignOutScope }) => {
    setSigningOut(true);
    const signedOut = await signOutOrExplain({
      auth: supabase.auth,
      scope: options?.scope,
      isOnline: () => typeof navigator === "undefined" || navigator.onLine,
      onSignedOut: () => {
        resetPh();
        window.location.href = "/";
      },
      onFailed: (message) => toast.error(message),
    });
    if (!signedOut) setSigningOut(false);
  }, []);

  const auth = useMemo(
    () => ({
      user: snapshot.user,
      session: snapshot.session,
      // Reconnecting counts as loading so no page treats "can't reach the auth
      // server" as "signed out".
      loading: snapshot.status === "loading" || snapshot.status === "reconnecting",
      signingOut,
      signOut,
    }),
    [snapshot, signingOut, signOut],
  );

  const connection = useMemo(
    () => ({
      status: snapshot.status,
      retryNow: () => store.retryNow("user"),
      refreshNow: retryMidSession,
    }),
    [snapshot.status, store, retryMidSession],
  );

  return (
    <AuthConnectionContext.Provider value={connection}>
      <AuthContext.Provider value={auth}>
        {children}
        {sessionUnavailable && snapshot.status === "signed-in" && (
          <SessionNotice onRetry={retryMidSession} />
        )}
      </AuthContext.Provider>
    </AuthConnectionContext.Provider>
  );
}
