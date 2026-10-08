import { describe, expect, test } from "bun:test";
import { isRedirect } from "@tanstack/react-router";
import {
  AuthApiError,
  AuthRetryableFetchError,
  type AuthError,
  type Session,
} from "@supabase/supabase-js";
import { requireSignedIn } from "./auth-guard";

type Read = { data: { session: Session | null }; error: AuthError | null };

function authReturning(result: Read | (() => never)) {
  return {
    getSession: async () => (typeof result === "function" ? result() : result),
  };
}

const session = {
  access_token: "a",
  refresh_token: "r",
  expires_in: 3600,
  expires_at: 1_900_000_000,
  token_type: "bearer",
  user: { id: "u1", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "" },
} as Session;

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe("requireSignedIn", () => {
  test("lets a signed-in member through", async () => {
    const auth = authReturning({ data: { session }, error: null });
    const read = await requireSignedIn(auth, { href: "/history" });
    expect(read.kind).toBe("session");
  });

  test("sends a signed-out visitor to /login carrying the page she wanted", async () => {
    const auth = authReturning({ data: { session: null }, error: null });
    const error = await caught(requireSignedIn(auth, { href: "/history?look=abc" }));
    expect(isRedirect(error)).toBe(true);
    const options = (error as { options: { to?: string; search?: unknown } }).options;
    expect(options.to).toBe("/login");
    expect(options.search).toEqual({ redirect: "/history?look=abc" });
  });

  test("a rejected refresh token is a real sign-out and redirects", async () => {
    const auth = authReturning({
      data: { session: null },
      error: new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found"),
    });
    const error = await caught(requireSignedIn(auth, { href: "/dashboard" }));
    expect(isRedirect(error)).toBe(true);
  });

  test("never carries an unsafe return path", async () => {
    const auth = authReturning({ data: { session: null }, error: null });
    const error = await caught(requireSignedIn(auth, { href: "//evil.example" }));
    const options = (error as { options: { search?: unknown } }).options;
    expect(options.search).toEqual({});
  });

  test("a network failure while refreshing does NOT redirect to /login", async () => {
    const auth = authReturning({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    const error = await caught(requireSignedIn(auth, { href: "/history" }));
    expect(error).toBeNull();
  });

  test("a 503 from the auth server does NOT redirect to /login", async () => {
    const auth = authReturning({
      data: { session: null },
      error: new AuthRetryableFetchError("Service unavailable", 503),
    });
    expect(await caught(requireSignedIn(auth, { href: "/history" }))).toBeNull();
  });

  test("an unexpected throw while reading the session does NOT redirect to /login", async () => {
    const auth = authReturning(() => {
      throw new TypeError("storage unavailable");
    });
    expect(await caught(requireSignedIn(auth, { href: "/history" }))).toBeNull();
  });
});
