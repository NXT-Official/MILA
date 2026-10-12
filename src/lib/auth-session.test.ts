import { describe, expect, test } from "bun:test";
import {
  AuthApiError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
  type AuthChangeEvent,
  type AuthError,
  type Session,
  type User,
} from "@supabase/supabase-js";
import {
  INITIAL_AUTH_SNAPSHOT,
  classifySessionRead,
  createAuthSessionStore,
  endSession,
  forgetCachedRefreshFailure,
  signOutFailureMessage,
  signOutOrExplain,
  clearSessionUnavailable,
  reportSessionUnavailable,
  isSessionUnavailable,
  subscribeSessionUnavailable,
  isMemberSessionUnavailable,
  memberAuthorization,
  reduceAuthEvent,
  refreshSessionNow,
  sessionCameBack,
  type AuthClientLike,
  type AuthSnapshot,
} from "./auth-session";

function makeUser(id: string, email = `${id}@example.com`): User {
  return {
    id,
    email,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  } as User;
}

/** A session as auth-js hands it over: a fresh object every time it is read. */
function makeSession(userId: string, accessToken = `access-${userId}`): Session {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${userId}`,
    expires_in: 3600,
    expires_at: 1_900_000_000,
    token_type: "bearer",
    user: makeUser(userId),
  };
}

function signedIn(userId: string, accessToken?: string): AuthSnapshot {
  const session = makeSession(userId, accessToken);
  return { status: "signed-in", session, user: session.user };
}

describe("reduceAuthEvent: one member, one stable user object", () => {
  test("SIGNED_IN for the same member on tab return keeps the very same user object", () => {
    const prev = signedIn("u1");
    // auth-js re-parses the session from storage on every visibilitychange and
    // emits SIGNED_IN with it: same member, brand-new object.
    const next = reduceAuthEvent(prev, "SIGNED_IN", makeSession("u1"));
    expect(next.user).toBe(prev.user);
  });

  test("SIGNED_IN for the same member with the same token changes nothing at all", () => {
    const prev = signedIn("u1");
    expect(reduceAuthEvent(prev, "SIGNED_IN", makeSession("u1"))).toBe(prev);
    expect(reduceAuthEvent(prev, "INITIAL_SESSION", makeSession("u1"))).toBe(prev);
  });

  test("TOKEN_REFRESHED for the same member takes the new token but keeps the user object", () => {
    const prev = signedIn("u1", "old-token");
    const next = reduceAuthEvent(prev, "TOKEN_REFRESHED", makeSession("u1", "new-token"));
    expect(next.session?.access_token).toBe("new-token");
    expect(next.user).toBe(prev.user);
    expect(next.status).toBe("signed-in");
  });

  test("USER_UPDATED is a real change to the member and replaces the user object", () => {
    const prev = signedIn("u1");
    const updated = makeSession("u1");
    updated.user = makeUser("u1", "new@example.com");
    const next = reduceAuthEvent(prev, "USER_UPDATED", updated);
    expect(next.user).toBe(updated.user);
    expect(next.user?.email).toBe("new@example.com");
  });

  test("SIGNED_IN with a confirmed new email (another tab) replaces the user, so user and session agree", () => {
    const prev = signedIn("u1");
    const changed = makeSession("u1", "token-2");
    changed.user = makeUser("u1", "new@example.com");
    const next = reduceAuthEvent(prev, "SIGNED_IN", changed);
    expect(next.user).toBe(changed.user);
    expect(next.user?.email).toBe("new@example.com");
    expect(next.session?.user.email).toBe(next.user?.email);
  });

  test("TOKEN_REFRESHED with changed metadata replaces the user", () => {
    const prev = signedIn("u1", "t1");
    const refreshed = makeSession("u1", "t2");
    refreshed.user = { ...makeUser("u1"), user_metadata: { username: "renamed" } };
    const next = reduceAuthEvent(prev, "TOKEN_REFRESHED", refreshed);
    expect(next.user).toBe(refreshed.user);
  });

  test("TOKEN_REFRESHED with identical member data keeps the user object (only the token moves)", () => {
    const prev = signedIn("u1", "t1");
    const refreshed = makeSession("u1", "t2");
    // Same data, new object, and a sign-in timestamp that is not member data.
    refreshed.user = { ...makeUser("u1"), last_sign_in_at: "2026-10-07T10:00:00Z" };
    const next = reduceAuthEvent(prev, "TOKEN_REFRESHED", refreshed);
    expect(next.user).toBe(prev.user);
    expect(next.session?.access_token).toBe("t2");
  });

  test("an identical SIGNED_IN on tab return still changes nothing at all", () => {
    const prev = signedIn("u1");
    const again = makeSession("u1");
    again.user = JSON.parse(JSON.stringify(prev.user));
    expect(reduceAuthEvent(prev, "SIGNED_IN", again)).toBe(prev);
  });

  test("a different member replaces the user object", () => {
    const prev = signedIn("u1");
    const other = makeSession("u2");
    const next = reduceAuthEvent(prev, "SIGNED_IN", other);
    expect(next.user).toBe(other.user);
    expect(next.user?.id).toBe("u2");
  });

  test("the first session after loading signs her in", () => {
    const session = makeSession("u1");
    const next = reduceAuthEvent(INITIAL_AUTH_SNAPSHOT, "INITIAL_SESSION", session);
    expect(next).toEqual({ status: "signed-in", session, user: session.user });
  });

  test("SIGNED_OUT signs her out", () => {
    const next = reduceAuthEvent(signedIn("u1"), "SIGNED_OUT", null);
    expect(next).toEqual({ status: "signed-out", session: null, user: null });
  });

  test("an INITIAL_SESSION without a session is not proof she is signed out", () => {
    // auth-js 2.110.0 emits INITIAL_SESSION(null) when the session read failed
    // with ANY error, including a network blip (GoTrueClient.ts _emitInitialSession).
    const loading = INITIAL_AUTH_SNAPSHOT;
    expect(reduceAuthEvent(loading, "INITIAL_SESSION", null)).toBe(loading);
    const prev = signedIn("u1");
    expect(reduceAuthEvent(prev, "INITIAL_SESSION", null)).toBe(prev);
  });
});

describe("classifySessionRead", () => {
  test("a session is a session", () => {
    const session = makeSession("u1");
    expect(classifySessionRead({ data: { session }, error: null })).toEqual({
      kind: "session",
      session,
    });
  });

  test("no session and no error means signed out", () => {
    expect(classifySessionRead({ data: { session: null }, error: null })).toEqual({
      kind: "signed-out",
    });
  });

  test("a network or 5xx failure while refreshing is not a sign-out", () => {
    const error = new AuthRetryableFetchError("Failed to fetch", 0);
    expect(classifySessionRead({ data: { session: null }, error })).toEqual({
      kind: "unreachable",
      error,
    });
    const gateway = new AuthRetryableFetchError("Bad gateway", 502);
    expect(classifySessionRead({ data: { session: null }, error: gateway }).kind).toBe(
      "unreachable",
    );
  });

  test("a refresh discarded because another tab rotated the token is retried, not a sign-out", () => {
    const error = new AuthRefreshDiscardedError();
    expect(classifySessionRead({ data: { session: null }, error }).kind).toBe("unreachable");
  });

  test("a refresh token the server rejected is a real sign-out", () => {
    const error = new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found");
    expect(classifySessionRead({ data: { session: null }, error })).toEqual({
      kind: "signed-out",
    });
  });
});

type Listener = (event: AuthChangeEvent, session: Session | null) => void;
type Read = { data: { session: Session | null }; error: AuthError | null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A fake auth client: each getSession() call waits for the test to answer it. */
function fakeAuth() {
  const listeners = new Set<Listener>();
  const reads: Array<ReturnType<typeof deferred<Read>>> = [];
  let unsubscribed = 0;
  const auth: AuthClientLike = {
    getSession: () => {
      const d = deferred<Read>();
      reads.push(d);
      return d.promise;
    },
    onAuthStateChange: (cb) => {
      listeners.add(cb);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              listeners.delete(cb);
              unsubscribed += 1;
            },
          },
        },
      };
    },
  };
  return {
    auth,
    reads,
    emit: (event: AuthChangeEvent, session: Session | null) => {
      for (const cb of listeners) cb(event, session);
    },
    listenerCount: () => listeners.size,
    unsubscribed: () => unsubscribed,
  };
}

/** Manual timers: nothing fires until the test says so. */
function fakeTimers() {
  let next = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id: unknown) => {
      pending.delete(id as number);
    },
    pendingDelays: () => [...pending.values()].map((t) => t.ms),
    fireAll: () => {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, t] of due) t.fn();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(retryDelaysMs = [1000, 2000, 4000]) {
  const fake = fakeAuth();
  const timers = fakeTimers();
  let wake: (() => void) | null = null;
  let wakeUnsubscribed = 0;
  const store = createAuthSessionStore(() => fake.auth, {
    retryDelaysMs,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onWake: (retry) => {
      wake = retry;
      return () => {
        wake = null;
        wakeUnsubscribed += 1;
      };
    },
  });
  const notifications: AuthSnapshot[] = [];
  store.subscribe(() => notifications.push(store.getSnapshot()));
  return {
    fake,
    timers,
    store,
    notifications,
    wake: () => wake?.(),
    wakeUnsubscribed: () => wakeUnsubscribed,
  };
}

describe("createAuthSessionStore", () => {
  test("starts loading and signs her in from the stored session", async () => {
    const { fake, store } = setup();
    expect(store.getSnapshot().status).toBe("loading");
    store.start();
    const session = makeSession("u1");
    fake.reads[0].resolve({ data: { session }, error: null });
    await flush();
    expect(store.getSnapshot()).toEqual({ status: "signed-in", session, user: session.user });
  });

  test("no stored session means signed out", async () => {
    const { fake, store } = setup();
    store.start();
    fake.reads[0].resolve({ data: { session: null }, error: null });
    await flush();
    expect(store.getSnapshot().status).toBe("signed-out");
  });

  test("a network failure at startup reconnects instead of signing her out", async () => {
    const { fake, store, timers } = setup();
    store.start();
    // auth-js reports the failure through both channels: INITIAL_SESSION(null)...
    fake.emit("INITIAL_SESSION", null);
    // ...and getSession() → { session: null, error: AuthRetryableFetchError }.
    fake.reads[0].resolve({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    await flush();
    expect(store.getSnapshot().status).toBe("reconnecting");
    expect(store.getSnapshot().user).toBeNull();
    expect(timers.pendingDelays()).toEqual([1000]);

    // Still offline on the first retry: back off further, still not signed out.
    timers.fireAll();
    expect(fake.reads).toHaveLength(2);
    fake.reads[1].resolve({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    await flush();
    expect(store.getSnapshot().status).toBe("reconnecting");
    expect(timers.pendingDelays()).toEqual([2000]);

    // The network is back: the stored session refreshes and she is in.
    timers.fireAll();
    const session = makeSession("u1");
    fake.reads[2].resolve({ data: { session }, error: null });
    await flush();
    expect(store.getSnapshot()).toEqual({ status: "signed-in", session, user: session.user });
    expect(timers.pendingDelays()).toEqual([]);
  });

  test("backoff stays at the last delay instead of giving up", async () => {
    const { fake, store, timers } = setup([1000, 2000]);
    store.start();
    for (let i = 0; i < 4; i += 1) {
      fake.reads[i].resolve({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      });
      await flush();
      expect(timers.pendingDelays()).toEqual([i === 0 ? 1000 : 2000]);
      timers.fireAll();
    }
    expect(store.getSnapshot().status).toBe("reconnecting");
  });

  test("a thrown error while reading the session reconnects instead of signing her out", async () => {
    const { fake, store } = setup();
    store.start();
    fake.reads[0].reject(new TypeError("storage unavailable"));
    await flush();
    expect(store.getSnapshot().status).toBe("reconnecting");
  });

  test("a refreshed token arriving while reconnecting signs her in and stops retrying", async () => {
    const { fake, store, timers } = setup();
    store.start();
    fake.reads[0].resolve({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    await flush();
    expect(timers.pendingDelays()).toEqual([1000]);
    const session = makeSession("u1");
    fake.emit("TOKEN_REFRESHED", session);
    expect(store.getSnapshot().status).toBe("signed-in");
    expect(timers.pendingDelays()).toEqual([]);
  });

  test("coming back online retries immediately while reconnecting", async () => {
    const { fake, store, timers, wake } = setup();
    store.start();
    fake.reads[0].resolve({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    await flush();
    wake();
    expect(fake.reads).toHaveLength(2);
    expect(timers.pendingDelays()).toEqual([]);
    const session = makeSession("u1");
    fake.reads[1].resolve({ data: { session }, error: null });
    await flush();
    expect(store.getSnapshot().status).toBe("signed-in");
  });

  test("a wake signal does nothing once she is signed in", async () => {
    const { fake, store, wake } = setup();
    store.start();
    fake.reads[0].resolve({ data: { session: makeSession("u1") }, error: null });
    await flush();
    wake();
    expect(fake.reads).toHaveLength(1);
  });

  test("tab return (SIGNED_IN, same member, same token) notifies nobody", async () => {
    const { fake, store, notifications } = setup();
    store.start();
    fake.reads[0].resolve({ data: { session: makeSession("u1") }, error: null });
    await flush();
    const before = store.getSnapshot();
    const count = notifications.length;
    fake.emit("SIGNED_IN", makeSession("u1"));
    fake.emit("SIGNED_IN", makeSession("u1"));
    expect(store.getSnapshot()).toBe(before);
    expect(notifications).toHaveLength(count);
  });

  test("a token refresh keeps the user object her pages depend on", async () => {
    const { fake, store } = setup();
    store.start();
    fake.reads[0].resolve({ data: { session: makeSession("u1", "t1") }, error: null });
    await flush();
    const user = store.getSnapshot().user;
    fake.emit("TOKEN_REFRESHED", makeSession("u1", "t2"));
    expect(store.getSnapshot().session?.access_token).toBe("t2");
    expect(store.getSnapshot().user).toBe(user);
  });

  test("a slow startup read cannot undo a sign-in that happened meanwhile", async () => {
    const { fake, store } = setup();
    store.start();
    const session = makeSession("u1");
    fake.emit("SIGNED_IN", session);
    fake.reads[0].resolve({ data: { session: null }, error: null });
    await flush();
    expect(store.getSnapshot().status).toBe("signed-in");
    expect(store.getSnapshot().user?.id).toBe("u1");
  });

  test("SIGNED_OUT from another tab signs this tab out", async () => {
    const { fake, store } = setup();
    store.start();
    fake.reads[0].resolve({ data: { session: makeSession("u1") }, error: null });
    await flush();
    fake.emit("SIGNED_OUT", null);
    expect(store.getSnapshot()).toEqual({ status: "signed-out", session: null, user: null });
  });

  test("stop() unsubscribes and cancels retries; start() again works (React StrictMode)", async () => {
    const { fake, store, timers, wakeUnsubscribed } = setup();
    store.start();
    fake.reads[0].resolve({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    await flush();
    expect(timers.pendingDelays()).toEqual([1000]);
    store.stop();
    expect(fake.listenerCount()).toBe(0);
    expect(fake.unsubscribed()).toBe(1);
    expect(wakeUnsubscribed()).toBe(1);
    expect(timers.pendingDelays()).toEqual([]);

    store.start();
    expect(fake.listenerCount()).toBe(1);
    const session = makeSession("u1");
    fake.reads[1].resolve({ data: { session }, error: null });
    await flush();
    expect(store.getSnapshot().status).toBe("signed-in");
  });

  test("a read that lands after stop() changes nothing", async () => {
    const { fake, store } = setup();
    store.start();
    store.stop();
    fake.reads[0].resolve({ data: { session: null }, error: null });
    await flush();
    expect(store.getSnapshot().status).toBe("loading");
  });

  test("retryNow() reads again only while reconnecting", async () => {
    const { fake, store } = setup();
    store.start();
    store.retryNow();
    expect(fake.reads).toHaveLength(1);
    fake.reads[0].resolve({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    await flush();
    store.retryNow();
    expect(fake.reads).toHaveLength(2);
  });
});

describe("endSession", () => {
  function fakeSignOut(result: { error: AuthError | null }) {
    const calls: Array<{ scope?: string } | undefined> = [];
    return {
      calls,
      auth: {
        signOut: async (options?: { scope?: "global" | "local" | "others" }) => {
          calls.push(options);
          return result;
        },
      },
    };
  }

  test("signs out this device only by default, never every device she owns", async () => {
    // auth-js 2.110.0 `signOut(options = { scope: 'global' })` revokes every
    // session of the account unless told otherwise.
    const { auth, calls } = fakeSignOut({ error: null });
    await endSession(auth);
    expect(calls).toEqual([{ scope: "local" }]);
  });

  test("passes an explicit scope through", async () => {
    const { auth, calls } = fakeSignOut({ error: null });
    await endSession(auth, "global");
    expect(calls).toEqual([{ scope: "global" }]);
  });

  test("reports a sign-out that did not happen instead of pretending it did", async () => {
    // A network failure leaves the stored session in place (auth-js only
    // clears it on 401/403/404), so she is still signed in on this device.
    const error = new AuthRetryableFetchError("Failed to fetch", 0);
    const { auth } = fakeSignOut({ error });
    let thrown: unknown = null;
    try {
      await endSession(auth);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(error);
  });
});

describe("memberAuthorization: a member read never runs as anonymous", () => {
  const authWith = (result: { data: { session: Session | null }; error: AuthError | null }) => ({
    getSession: async () => result,
  });

  test("hands back her own bearer token", async () => {
    const session = makeSession("u1", "member-token");
    expect(await memberAuthorization(authWith({ data: { session }, error: null }), "u1")).toBe(
      "Bearer member-token",
    );
  });

  test("refuses while the refresh is failing instead of falling back to the publishable key", async () => {
    // supabase-js 2.110.0 `_getAccessToken` returns
    // `data.session?.access_token ?? this.supabaseKey` (SupabaseClient.ts:570-578).
    const auth = authWith({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    let thrown: unknown = null;
    try {
      await memberAuthorization(auth, "u1");
    } catch (error) {
      thrown = error;
    }
    expect(isMemberSessionUnavailable(thrown)).toBe(true);
  });

  test("refuses when signed out or when the stored session is someone else's", async () => {
    for (const result of [
      { data: { session: null }, error: null },
      { data: { session: makeSession("u2") }, error: null },
    ]) {
      let thrown: unknown = null;
      try {
        await memberAuthorization(authWith(result), "u1");
      } catch (error) {
        thrown = error;
      }
      expect(isMemberSessionUnavailable(thrown)).toBe(true);
    }
  });

  test("ordinary errors are not mistaken for an unavailable session", () => {
    expect(isMemberSessionUnavailable(new Error("boom"))).toBe(false);
    expect(isMemberSessionUnavailable(null)).toBe(false);
  });
});

describe("signOutFailureMessage", () => {
  test("offline: a calm message, never a raw 'Failed to fetch'", () => {
    const message = signOutFailureMessage(new AuthRetryableFetchError("Failed to fetch", 0), true);
    expect(message).toBe(
      "You're offline, so we couldn't sign you out yet. Try again once you're back online.",
    );
    expect(signOutFailureMessage(new Error("anything"), false)).toBe(message);
  });

  test("online but refused: a calm retry message", () => {
    expect(signOutFailureMessage(new Error("boom"), true)).toBe(
      "We couldn't sign you out just now. Please try again.",
    );
  });

  test("no dashes in either message", () => {
    for (const m of [
      signOutFailureMessage(new Error("x"), true),
      signOutFailureMessage(new Error("x"), false),
    ]) {
      expect(m).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("forgetCachedRefreshFailure", () => {
  test("clears auth-js's cached refresh failure so the next attempt really goes out", () => {
    const auth = { lastRefreshFailure: { refreshToken: "r", expiresAt: 1, result: {} } };
    forgetCachedRefreshFailure(auth);
    expect(auth.lastRefreshFailure).toBeNull();
  });

  test("does nothing to a client without that cache (another auth-js version)", () => {
    const auth: Record<string, unknown> = {};
    forgetCachedRefreshFailure(auth);
    expect("lastRefreshFailure" in auth).toBe(false);
  });
});

describe("store: retries she asks for really retry", () => {
  function setupWithFresh() {
    const fake = fakeAuth();
    const timers = fakeTimers();
    const fresh: string[] = [];
    let wake: ((reason: "online" | "visible") => void) | null = null;
    const store = createAuthSessionStore(() => fake.auth, {
      retryDelaysMs: [1000],
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      forceFreshAttempt: () => fresh.push(`fresh@read${fake.reads.length}`),
      onWake: (retry) => {
        wake = retry;
        return () => {
          wake = null;
        };
      },
    });
    return { fake, store, fresh, wake: (reason: "online" | "visible") => wake?.(reason) };
  }

  async function reconnecting(fake: ReturnType<typeof fakeAuth>) {
    fake.reads[fake.reads.length - 1].resolve({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    await flush();
  }

  test("Try again clears the cached failure first, then reads immediately", async () => {
    const { fake, store, fresh } = setupWithFresh();
    store.start();
    await reconnecting(fake);
    store.retryNow();
    expect(fresh).toEqual(["fresh@read1"]);
    expect(fake.reads).toHaveLength(2);
  });

  test("the network coming back also tries for real; a tab becoming visible does not force it", async () => {
    const { fake, store, fresh, wake } = setupWithFresh();
    store.start();
    await reconnecting(fake);
    wake("visible");
    expect(fresh).toEqual([]);
    expect(fake.reads).toHaveLength(2);
    await reconnecting(fake);
    wake("online");
    expect(fresh).toEqual(["fresh@read2"]);
    expect(fake.reads).toHaveLength(3);
  });
});

describe("signOutOrExplain", () => {
  test("signed out: leaves for the landing", async () => {
    const left: string[] = [];
    const ok = await signOutOrExplain({
      auth: { signOut: async () => ({ error: null }) },
      isOnline: () => true,
      onSignedOut: () => left.push("left"),
      onFailed: (m) => left.push(m),
    });
    expect(ok).toBe(true);
    expect(left).toEqual(["left"]);
  });

  test("offline: a calm message, no throw, she stays where she is", async () => {
    const seen: string[] = [];
    const ok = await signOutOrExplain({
      auth: { signOut: async () => ({ error: new AuthRetryableFetchError("Failed to fetch", 0) }) },
      isOnline: () => false,
      onSignedOut: () => seen.push("left"),
      onFailed: (m) => seen.push(m),
    });
    expect(ok).toBe(false);
    expect(seen).toEqual([
      "You're offline, so we couldn't sign you out yet. Try again once you're back online.",
    ]);
  });

  test("a thrown error is explained too, never an unhandled rejection", async () => {
    const seen: string[] = [];
    const ok = await signOutOrExplain({
      auth: {
        signOut: async () => {
          throw new TypeError("Failed to fetch");
        },
      },
      isOnline: () => true,
      onSignedOut: () => seen.push("left"),
      onFailed: (m) => seen.push(m),
    });
    expect(ok).toBe(false);
    expect(seen).toEqual(["We couldn't sign you out just now. Please try again."]);
  });

  test("passes the scope through, local by default", async () => {
    const scopes: unknown[] = [];
    const auth = {
      signOut: async (options?: { scope?: "global" | "local" | "others" }) => {
        scopes.push(options?.scope);
        return { error: null };
      },
    };
    const base = { auth, isOnline: () => true, onSignedOut: () => {}, onFailed: () => {} };
    await signOutOrExplain(base);
    await signOutOrExplain({ ...base, scope: "global" });
    expect(scopes).toEqual(["local", "global"]);
  });
});

describe("the installed auth-js still has the cache 'Try again' clears (N-5)", () => {
  test("a real 2.110.0 client exposes lastRefreshFailure on supabase.auth", async () => {
    // If an auth-js upgrade renames it, forgetCachedRefreshFailure silently
    // becomes a no-op and "Try again" waits out the 60 s cooldown again.
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient("https://pinning.supabase.co", "sb_publishable_test", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect("lastRefreshFailure" in client.auth).toBe(true);
    expect(
      (client.auth as unknown as { lastRefreshFailure: unknown }).lastRefreshFailure,
    ).toBeNull();
  });
});

describe("session-unavailable signal (N-3: a mid-session refresh failure surfaces calmly)", () => {
  test("a refused member read reports it; clearing it notifies once", async () => {
    clearSessionUnavailable();
    const seen: boolean[] = [];
    const unsubscribe = subscribeSessionUnavailable(() => seen.push(isSessionUnavailable()));
    const auth = {
      getSession: async () => ({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      }),
    };
    await memberAuthorization(auth, "u1").catch(() => undefined);
    await memberAuthorization(auth, "u1").catch(() => undefined);
    expect(isSessionUnavailable()).toBe(true);
    clearSessionUnavailable();
    clearSessionUnavailable();
    expect(seen).toEqual([true, false]);
    unsubscribe();
  });

  test("a successful member read does not report anything", async () => {
    clearSessionUnavailable();
    const auth = {
      getSession: async () => ({ data: { session: makeSession("u1") }, error: null }),
    };
    await memberAuthorization(auth, "u1");
    expect(isSessionUnavailable()).toBe(false);
  });
});

describe("R-3: the note clears as soon as a member read succeeds again", () => {
  test("a successful member read clears 'session unavailable' even with no auth event", async () => {
    // Cross-tab race: the other tab's refresh wins, this tab's own refresh is
    // discarded, getSession() then returns the other tab's valid session with
    // no event. The next successful read is the proof she is back.
    reportSessionUnavailable();
    const auth = {
      getSession: async () => ({ data: { session: makeSession("u1") }, error: null }),
    };
    await memberAuthorization(auth, "u1");
    expect(isSessionUnavailable()).toBe(false);
  });

  test("her Try again ends the note when getSession() hands back a usable session with no event", async () => {
    reportSessionUnavailable();
    const auth = {
      lastRefreshFailure: { refreshToken: "rt", expiresAt: Date.now() + 60_000 } as unknown,
      getSession: async () => ({ data: { session: makeSession("u1") }, error: null }),
    };
    await refreshSessionNow(auth);
    // The 60 s failure cache was dropped first, so the read was a real attempt.
    expect(auth.lastRefreshFailure).toBeNull();
    expect(isSessionUnavailable()).toBe(false);
  });

  test("her Try again keeps the note while the refresh still fails", async () => {
    reportSessionUnavailable();
    const auth = {
      getSession: async () => ({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      }),
    };
    await refreshSessionNow(auth);
    expect(isSessionUnavailable()).toBe(true);
    clearSessionUnavailable();
  });
});

describe("R-4: a read that failed while she was reconnecting runs again by itself", () => {
  const ready = (accessToken: string | null, unavailable: boolean) => ({
    accessToken,
    unavailable,
  });

  test("the note's Try again refreshed the token and the note cleared: run it again", () => {
    expect(sessionCameBack(ready("t1", true), ready("t2", false))).toBe(true);
  });

  test("a refresh won by another tab clears the note with no new token: run it again", () => {
    expect(sessionCameBack(ready("t2", true), ready("t2", false))).toBe(true);
  });

  test("a new token while the read failed for another reason: run it again", () => {
    expect(sessionCameBack(ready("t1", false), ready("t2", false))).toBe(true);
  });

  test("still reconnecting, or nothing changed: wait", () => {
    expect(sessionCameBack(ready("t1", true), ready("t2", true))).toBe(false);
    expect(sessionCameBack(ready("t1", true), ready("t1", true))).toBe(false);
    expect(sessionCameBack(ready("t1", false), ready("t1", false))).toBe(false);
  });

  test("no session at all (signed out): never", () => {
    expect(sessionCameBack(ready("t1", true), ready(null, false))).toBe(false);
  });
});
