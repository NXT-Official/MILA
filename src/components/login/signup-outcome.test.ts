import { describe, expect, test } from "bun:test";
import type { Session } from "@supabase/supabase-js";
import { SIGNUP_SIGN_IN_FAILED_COPY, signupSuccessMessage } from "./signup-outcome";

describe("signupSuccessMessage", () => {
  test("a member who got a session is welcomed, never sent to their inbox", () => {
    // Auto-confirm projects hand back a session, so the member lands in
    // onboarding straight away; there is nothing to confirm.
    const message = signupSuccessMessage({ access_token: "token" } as Session);

    expect(message).toBe("Welcome to Mila. Let's build your style profile.");
    expect(message).not.toMatch(/inbox|confirm/i);
  });

  test("with no session the member is told to confirm by email", () => {
    expect(signupSuccessMessage(null)).toBe("Studio profile created. Check your inbox to confirm.");
  });

  test("no sentence a member reads has an em-dash or en-dash", () => {
    for (const message of [
      signupSuccessMessage({ access_token: "token" } as Session),
      signupSuccessMessage(null),
      SIGNUP_SIGN_IN_FAILED_COPY,
    ]) {
      expect(message).not.toMatch(/[–—]/);
    }
  });
});

describe("SIGNUP_SIGN_IN_FAILED_COPY", () => {
  test("says the account exists and sends the member to log in, never to try creating it again", () => {
    expect(SIGNUP_SIGN_IN_FAILED_COPY).toBe(
      "Your account is ready, but we couldn't sign you in. Please log in to continue.",
    );
    expect(SIGNUP_SIGN_IN_FAILED_COPY).not.toMatch(/couldn't create/i);
  });
});
