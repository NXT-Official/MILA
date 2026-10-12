import {
  isAuthRefreshDiscardedError,
  isAuthRetryableFetchError,
  type AuthChangeEvent,
  type AuthError,
  type Session,
  type User,
} from "@supabase/supabase-js";

/**
 * The member's session as the web app sees it, and the rules that keep it from
 * being lost by accident. Pure logic plus a tiny external store, so the
 * provider stays thin and every rule here is unit tested.
 *
 * Grounded in @supabase/auth-js 2.110.0 (the version bun.lock pins), file
 * src/GoTrueClient.ts:
 *  - `_recoverAndRefresh` re-reads the session from storage on every
 *    `visibilitychange` to visible and emits `SIGNED_IN` with that freshly
 *    parsed object, so the same member arrives as a new `user` object on every
 *    tab return. We keep the first object while the id is unchanged.
 *  - `__loadSession` returns `{ session: null, error: AuthRetryableFetchError }`
 *    when the access token has expired and the refresh request failed on the
 *    network or a 5xx. `_callRefreshToken` does NOT remove the stored session
 *    for a retryable error, so she is still signed in: we reconnect, never
 *    send her to /login.
 *  - `_emitInitialSession` emits `INITIAL_SESSION` with `null` for ANY read
 *    error, retryable ones included, so a null initial event is not proof of a
 *    sign-out. Only `SIGNED_OUT` (emitted by `_removeSession`) is.
 *  - `REFRESH_FAILURE_COOLDOWN_MS` (60 s) caches a failed refresh per refresh
 *    token, so retries inside that window cost a storage read, not a request.
 * // src: node_modules/@supabase/auth-js/src/GoTrueClient.ts · 2.110.0
 */

export type AuthStatus = "loading" | "signed-in" | "signed-out" | "reconnecting";

export interface AuthSnapshot {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
}

export const INITIAL_AUTH_SNAPSHOT: AuthSnapshot = Object.freeze({
  status: "loading",
  session: null,
  user: null,
});

const SIGNED_OUT: AuthSnapshot = Object.freeze({
  status: "signed-out",
  session: null,
  user: null,
});

const RECONNECTING: AuthSnapshot = Object.freeze({
  status: "reconnecting",
  session: null,
  user: null,
});

/**
 * What the app shows or checks about the member. Timestamps that move on every
 * sign-in (`last_sign_in_at`, `updated_at`, the `*_sent_at` fields) are left
 * out, so a token refresh or a tab return with the same member data keeps the
 * same object.
 */
function memberData(user: User): string {
  return JSON.stringify([
    user.id,
    user.aud,
    user.role ?? null,
    user.email ?? null,
    user.phone ?? null,
    user.new_email ?? null,
    user.new_phone ?? null,
    user.email_confirmed_at ?? null,
    user.phone_confirmed_at ?? null,
    user.confirmed_at ?? null,
    user.is_anonymous ?? null,
    user.app_metadata ?? null,
    user.user_metadata ?? null,
    (user.identities ?? []).map((identity) => [identity.provider, identity.identity_id]),
  ]);
}

/**
 * Take a session into the snapshot. While the member is the same id with the
 * same data, the `user` object stays the same reference, so nothing keyed on
 * it re-runs, and an unchanged token changes nothing at all. Any change to her
 * data (an email change confirmed in another tab, new metadata) replaces the
 * object, so `user` never disagrees with `session.user`. Effects keyed on
 * `user?.id` never re-run for the same member either way.
 */
function applySession(prev: AuthSnapshot, session: Session, event?: AuthChangeEvent): AuthSnapshot {
  const sameMember = prev.user !== null && prev.user.id === session.user.id;
  if (!sameMember) return { status: "signed-in", session, user: session.user };

  const unchanged =
    event !== "USER_UPDATED" &&
    prev.user !== null &&
    memberData(prev.user) === memberData(session.user);
  const user = unchanged ? prev.user : session.user;
  if (
    prev.status === "signed-in" &&
    user === prev.user &&
    prev.session?.access_token === session.access_token
  ) {
    return prev;
  }
  return { status: "signed-in", session, user };
}

export function reduceAuthEvent(
  prev: AuthSnapshot,
  event: AuthChangeEvent,
  session: Session | null,
): AuthSnapshot {
  if (session) return applySession(prev, session, event);
  if (event === "SIGNED_OUT") return prev.status === "signed-out" ? prev : SIGNED_OUT;
  // A null session on any other event (INITIAL_SESSION after a failed read)
  // proves nothing; the store's own read decides.
  return prev;
}

export interface SessionReadResult {
  data: { session: Session | null };
  error: AuthError | null;
}

export type SessionRead =
  | { kind: "session"; session: Session }
  | { kind: "signed-out" }
  | { kind: "unreachable"; error: unknown };

/**
 * What a `getSession()` result means for routing. Retryable (network, 5xx)
 * and discarded (another tab rotated the token mid-flight) refresh failures
 * leave the stored session in place, so they mean "try again", never
 * "signed out".
 */
export function classifySessionRead(result: SessionReadResult): SessionRead {
  const { session } = result.data;
  if (session) return { kind: "session", session };
  const { error } = result;
  if (error && (isAuthRetryableFetchError(error) || isAuthRefreshDiscardedError(error))) {
    return { kind: "unreachable", error };
  }
  return { kind: "signed-out" };
}

export interface AuthClientLike {
  getSession(): Promise<SessionReadResult>;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
}

/** `getSession()` that never throws: an unexpected throw is treated as unreachable. */
export async function readSession(auth: Pick<AuthClientLike, "getSession">): Promise<SessionRead> {
  try {
    return classifySessionRead(await auth.getSession());
  } catch (error) {
    return { kind: "unreachable", error };
  }
}

/** A member-data read was refused because her session is not usable right now. */
export class MemberSessionUnavailableError extends Error {
  constructor() {
    super("Your session is reconnecting.");
    this.name = "MemberSessionUnavailableError";
  }
}

/**
 * "Her session is stored but not usable right now", raised mid-session by a
 * refused member read or by the fetch guard, and cleared when a refreshed
 * token lands. The auth provider shows the calm Reconnecting note while it is
 * set. The startup case has its own full-screen state (store status
 * "reconnecting"); this one never unmounts the page she is on.
 */
let sessionUnavailable = false;
const sessionUnavailableListeners = new Set<() => void>();

function setSessionUnavailable(next: boolean) {
  if (sessionUnavailable === next) return;
  sessionUnavailable = next;
  for (const listener of [...sessionUnavailableListeners]) listener();
}

export function reportSessionUnavailable(): void {
  setSessionUnavailable(true);
}

export function clearSessionUnavailable(): void {
  setSessionUnavailable(false);
}

export function isSessionUnavailable(): boolean {
  return sessionUnavailable;
}

export function subscribeSessionUnavailable(listener: () => void): () => void {
  sessionUnavailableListeners.add(listener);
  return () => {
    sessionUnavailableListeners.delete(listener);
  };
}

/**
 * The error code the Supabase client's fetch guard answers with when a
 * database or storage request would have gone out as anonymous while her
 * session is stored (src/integrations/supabase/member-fetch-guard.ts).
 */
export const SESSION_UNAVAILABLE_CODE = "MILA_SESSION_UNAVAILABLE";

/** Her session is not usable right now: a refused member read, or the fetch guard's answer. */
export function isMemberSessionUnavailable(error: unknown): boolean {
  if (error instanceof Error && error.name === "MemberSessionUnavailableError") return true;
  if (typeof error !== "object" || error === null) return false;
  // PostgREST hands the body back as `error.code`; storage-js as
  // `StorageApiError.statusCode`.
  const { code, statusCode } = error as { code?: unknown; statusCode?: unknown };
  return code === SESSION_UNAVAILABLE_CODE || statusCode === SESSION_UNAVAILABLE_CODE;
}

/**
 * The `Authorization` header for one member-data read, or a throw.
 *
 * When `getSession()` has no session (the refresh just failed), supabase-js
 * sends the request with the publishable key instead: `_getAccessToken`
 * returns `data.session?.access_token ?? this.supabaseKey`
 * (supabase-js 2.110.0 src/SupabaseClient.ts:570-578). RLS then returns no
 * rows, which a query reads as "0 credits" or "no profile" and caches over her
 * real data. `fetchWithAuth` only sets `Authorization` when the request has
 * none (src/lib/fetch.ts:42-52), so a read that sets it explicitly
 * (`.setHeader("Authorization", …)`, postgrest-js 2.110.0
 * src/PostgrestBuilder.ts:235) can never run as anonymous: it either runs as
 * her, or fails and React Query keeps the last good data.
 * // src: node_modules/@supabase/supabase-js/src/SupabaseClient.ts · 2.110.0
 */
export async function memberAuthorization(
  auth: Pick<AuthClientLike, "getSession">,
  userId: string,
): Promise<string> {
  const read = await readSession(auth);
  if (read.kind !== "session" || read.session.user.id !== userId) {
    // Stored but not refreshable right now: tell her calmly (N-3).
    if (read.kind === "unreachable") reportSessionUnavailable();
    throw new MemberSessionUnavailableError();
  }
  // She is readable again. Clear the note even when no auth event says so: a
  // refresh won by another tab is picked up from storage with no event (R-3).
  clearSessionUnavailable();
  return `Bearer ${read.session.access_token}`;
}

export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 30_000];

export interface AuthSessionStoreOptions {
  /** Backoff between reconnect attempts; the last delay repeats forever. */
  retryDelaysMs?: readonly number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Subscribe to "worth trying now" signals (back online, tab visible). */
  onWake?: (retry: (reason?: WakeReason) => void) => () => void;
  /**
   * Called before a retry she asked for, or one the network coming back
   * earned, so it can really reach the server (see forgetCachedRefreshFailure).
   */
  forceFreshAttempt?: () => void;
}

/** Why a reconnect attempt is being made now. */
export type WakeReason = "user" | "online" | "visible";

export interface AuthSessionStore {
  getSnapshot(): AuthSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  /** Reconnect now. Defaults to "user": she pressed Try again. */
  retryNow(reason?: WakeReason): void;
}

export function createAuthSessionStore(
  getAuth: () => AuthClientLike,
  options: AuthSessionStoreOptions = {},
): AuthSessionStore {
  const delays =
    options.retryDelaysMs && options.retryDelaysMs.length > 0
      ? options.retryDelaysMs
      : DEFAULT_RETRY_DELAYS_MS;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let snapshot: AuthSnapshot = INITIAL_AUTH_SNAPSHOT;
  const listeners = new Set<() => void>();
  let running = false;
  // Bumped on every start/stop: a read from an earlier run is ignored.
  let generation = 0;
  // Bumped on every auth event that settled the state: a read that started
  // before it is older news and is ignored.
  let decided = 0;
  let inFlight: number | null = null;
  let retryHandle: unknown = null;
  let attempt = 0;
  let unsubscribeAuth: (() => void) | null = null;
  let unsubscribeWake: (() => void) | null = null;

  function publish(next: AuthSnapshot) {
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  function cancelRetry() {
    if (retryHandle === null) return;
    clearTimer(retryHandle);
    retryHandle = null;
  }

  function settle(next: AuthSnapshot) {
    cancelRetry();
    attempt = 0;
    publish(next);
  }

  function scheduleRetry() {
    if (!running || retryHandle !== null) return;
    const delay = delays[Math.min(attempt, delays.length - 1)];
    attempt += 1;
    retryHandle = setTimer(() => {
      retryHandle = null;
      void read();
    }, delay);
  }

  async function read() {
    const gen = generation;
    if (!running || inFlight === gen) return;
    inFlight = gen;
    const decidedAtStart = decided;
    const outcome = await readSession(getAuth());
    if (inFlight === gen) inFlight = null;
    if (!running || gen !== generation || decided !== decidedAtStart) return;

    if (outcome.kind === "session") {
      settle(applySession(snapshot, outcome.session));
    } else if (outcome.kind === "signed-out") {
      settle(SIGNED_OUT);
    } else {
      publish(snapshot.status === "signed-in" ? snapshot : RECONNECTING);
      scheduleRetry();
    }
  }

  function retryNow(reason: WakeReason = "user") {
    if (!running || snapshot.status !== "reconnecting") return;
    cancelRetry();
    // A tab turning visible is no reason to skip the auth-js failure cache;
    // her own tap, or the network coming back, is.
    if (reason !== "visible") options.forceFreshAttempt?.();
    void read();
  }

  function retryFromWake(reason: WakeReason = "visible") {
    retryNow(reason);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (running) return;
      running = true;
      generation += 1;
      const { data } = getAuth().onAuthStateChange((event, session) => {
        if (!running) return;
        if (session === null && event !== "SIGNED_OUT") return;
        decided += 1;
        settle(reduceAuthEvent(snapshot, event, session));
      });
      unsubscribeAuth = () => data.subscription.unsubscribe();
      unsubscribeWake = options.onWake ? options.onWake(retryFromWake) : null;
      void read();
    },
    stop() {
      if (!running) return;
      running = false;
      generation += 1;
      cancelRetry();
      attempt = 0;
      unsubscribeAuth?.();
      unsubscribeAuth = null;
      unsubscribeWake?.();
      unsubscribeWake = null;
    },
    retryNow: (reason?: WakeReason) => retryNow(reason),
  };
}

export type SignOutScope = "global" | "local" | "others";

/**
 * Sign out. Defaults to THIS device only: auth-js `signOut()` defaults to
 * `{ scope: 'global' }`, which revokes every session of the account, so one
 * "Sign out" tap on a laptop would also sign her out on her phone mid-look.
 * Pass "global" only where every device must end.
 *
 * auth-js returns (never throws) the error, and keeps the stored session when
 * the server call failed for anything but 401/403/404. Surface it, so the UI
 * never claims a sign-out that did not happen.
 * // src: node_modules/@supabase/auth-js/src/GoTrueClient.ts `signOut`/`_signOut` · 2.110.0
 */
export async function endSession(
  auth: {
    signOut(options?: { scope?: SignOutScope }): Promise<{ error: AuthError | null }>;
  },
  scope: SignOutScope = "local",
): Promise<void> {
  const { error } = await auth.signOut({ scope });
  if (error) throw error;
}

/**
 * Sign out, and when it does not happen, explain it calmly instead of
 * throwing: every sign-out button (the account menu, the suspended screen,
 * after account deletion) gets the same honest message and never an
 * unhandled rejection. Returns whether she is signed out.
 */
export async function signOutOrExplain(deps: {
  auth: Parameters<typeof endSession>[0];
  scope?: SignOutScope;
  isOnline: () => boolean;
  onSignedOut: () => void;
  onFailed: (message: string) => void;
}): Promise<boolean> {
  try {
    await endSession(deps.auth, deps.scope);
  } catch (error) {
    deps.onFailed(signOutFailureMessage(error, deps.isOnline()));
    return false;
  }
  deps.onSignedOut();
  return true;
}

/** Wake signals in the browser: the network came back, or the tab is visible again. */
export function browserWake(retry: (reason: WakeReason) => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const onVisible = () => {
    if (document.visibilityState === "visible") retry("visible");
  };
  const onOnline = () => retry("online");
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/**
 * auth-js caches a failed refresh for 60 s per refresh token
 * (`REFRESH_FAILURE_COOLDOWN_MS`, protected field `lastRefreshFailure`,
 * GoTrueClient.ts:306 and :4855-4861) to stop refresh storms during an outage.
 * Every public refresh path (getSession, refreshSession, setSession, the
 * auto-refresh tick) goes through that cache, so without this a "Try again"
 * tap, or Wi-Fi coming back, does nothing for up to a minute. Clearing it is
 * what auth-js itself does when another tab reports a successful refresh
 * (GoTrueClient.ts:508-509). Used only for her explicit tap and the `online`
 * event, never on a timer, so it cannot cause a storm. If a later auth-js
 * renames the field this is a no-op and the 60 s wait simply returns.
 * // src: node_modules/@supabase/auth-js/src/GoTrueClient.ts · 2.110.0
 */
export function forgetCachedRefreshFailure(auth: object): void {
  if ("lastRefreshFailure" in auth) {
    (auth as { lastRefreshFailure: unknown }).lastRefreshFailure = null;
  }
}

/**
 * Her Try again, mid-session: a real refresh attempt now (not auth-js's cached
 * failure). A success that changes the token emits TOKEN_REFRESHED, which the
 * provider turns into a cleared note. A usable session read back with no event
 * (another tab won the refresh race and this tab's own answer was discarded,
 * GoTrueClient.ts:4880-4902) ends the note here too (R-3).
 * // src: node_modules/@supabase/auth-js/src/GoTrueClient.ts · 2.110.0
 */
export async function refreshSessionNow(
  auth: Pick<AuthClientLike, "getSession"> & object,
): Promise<void> {
  forgetCachedRefreshFailure(auth);
  const read = await readSession(auth);
  if (read.kind === "session") clearSessionUnavailable();
}

/** What a page knows about her session when a read of hers fails or succeeds. */
export interface SessionReadiness {
  accessToken: string | null;
  /** The "session unavailable" signal (the Reconnecting note). */
  unavailable: boolean;
}

/**
 * Whether her session came back between two moments, so a read that failed
 * while she was reconnecting should run again by itself (R-4): the note
 * cleared, or a new token landed. Never while the note is up or with no
 * session at all.
 */
export function sessionCameBack(before: SessionReadiness, now: SessionReadiness): boolean {
  if (now.unavailable || now.accessToken === null) return false;
  return before.unavailable || before.accessToken !== now.accessToken;
}

/**
 * What to tell her when signing out did not happen. auth-js keeps the stored
 * session when the server call fails for anything but 401/403/404, so she is
 * still signed in on this device: say so calmly, never "Failed to fetch".
 */
export function signOutFailureMessage(error: unknown, online: boolean): string {
  if (!online || isAuthRetryableFetchError(error)) {
    return "You're offline, so we couldn't sign you out yet. Try again once you're back online.";
  }
  return "We couldn't sign you out just now. Please try again.";
}
