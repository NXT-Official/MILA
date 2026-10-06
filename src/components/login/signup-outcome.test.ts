import { describe, expect, test } from "bun:test";
import type { Session } from "@supabase/supabase-js";
import { signupSuccessMessage } from "./signup-outcome";

describe("signupSuccessMessage", () => {
  test("a member who got a session is welcomed, never sent to their inbox", () => {
    // Auto-confirm projects hand back a session, so the member lands in
    // onboarding straight away; there is nothing to confirm.
    const message = signupSuccessMessage({ access_token: "token" } as Session);

    expect(message).toBe("Welcome to Mila — let's build your style profile.");
    expect(message).not.toMatch(/inbox|confirm/i);
  });

  test("with no session the member is told to confirm by email", () => {
    expect(signupSuccessMessage(null)).toBe("Studio profile created. Check your inbox to confirm.");
  });
});
