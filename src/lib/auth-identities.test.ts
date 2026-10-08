import { describe, expect, test } from "bun:test";
import type { User, UserIdentity } from "@supabase/supabase-js";
import { getSignInMethods } from "./auth-identities";

function identity(provider: string): UserIdentity {
  return {
    id: `${provider}-id`,
    user_id: "user-1",
    identity_id: `${provider}-identity`,
    provider,
    identity_data: {},
  } as UserIdentity;
}

function userWith(overrides: Partial<User>): User {
  return {
    id: "user-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("getSignInMethods", () => {
  test("an email identity means a password can be changed", () => {
    const methods = getSignInMethods(userWith({ identities: [identity("email")] }));
    expect(methods.hasPassword).toBe(true);
    expect(methods.providerLabels).toEqual([]);
  });

  test("a Google-only account has no password and says so", () => {
    const methods = getSignInMethods(userWith({ identities: [identity("google")] }));
    expect(methods.hasPassword).toBe(false);
    expect(methods.providerLabels).toEqual(["Google"]);
  });

  test("Google plus an email identity keeps the password form", () => {
    const methods = getSignInMethods(
      userWith({ identities: [identity("google"), identity("email")] }),
    );
    expect(methods.hasPassword).toBe(true);
  });

  test("falls back to app_metadata when identities are absent", () => {
    const googleOnly = getSignInMethods(
      userWith({ app_metadata: { provider: "google", providers: ["google"] } }),
    );
    expect(googleOnly.hasPassword).toBe(false);
    expect(googleOnly.providerLabels).toEqual(["Google"]);

    const both = getSignInMethods(
      userWith({ app_metadata: { provider: "google", providers: ["google", "email"] } }),
    );
    expect(both.hasPassword).toBe(true);
  });

  test("uses the single provider field when providers is missing", () => {
    expect(getSignInMethods(userWith({ app_metadata: { provider: "email" } })).hasPassword).toBe(
      true,
    );
    expect(getSignInMethods(userWith({ app_metadata: { provider: "google" } })).hasPassword).toBe(
      false,
    );
  });

  test("an empty identities list falls back to app_metadata", () => {
    const methods = getSignInMethods(
      userWith({ identities: [], app_metadata: { provider: "google" } }),
    );
    expect(methods.hasPassword).toBe(false);
  });

  test("when nothing is known the password form stays available", () => {
    expect(getSignInMethods(userWith({})).hasPassword).toBe(true);
    expect(getSignInMethods(null).hasPassword).toBe(true);
    expect(getSignInMethods(undefined).hasPassword).toBe(true);
  });

  test("an unrecognised provider is named plainly, not as a raw id", () => {
    const methods = getSignInMethods(userWith({ identities: [identity("apple")] }));
    expect(methods.hasPassword).toBe(false);
    expect(methods.providerLabels).toEqual(["Apple"]);
  });
});
