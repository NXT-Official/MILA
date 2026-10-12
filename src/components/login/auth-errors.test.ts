import { describe, expect, mock, test } from "bun:test";
import { authenticateWithPassword, type AuthDependencies } from "../../lib/auth-handler.server";
import { TimeoutError } from "@/lib/utils";
import {
  SIGNUP_FAILED_COPY,
  SIGNUP_NETWORK_COPY,
  SIGNUP_UPDATED_COPY,
  signupFailureMessage,
} from "./auth-errors";

const signup = {
  email: "someone@example.com",
  password: "Abcdefghij1!",
  username: "mila_user",
  captchaToken: "captcha-token",
};

/** What the real server handler throws when Supabase refuses a sign-up. */
async function thrownBySignup(providerError: unknown): Promise<unknown> {
  const deps = {
    client: () => ({
      auth: { signUp: mock(async () => ({ data: { session: null }, error: providerError })) },
    }),
  } as unknown as AuthDependencies;
  try {
    await authenticateWithPassword("signup", signup, deps);
  } catch (error) {
    return error;
  }
  throw new Error("sign-up was expected to fail");
}

describe("signupFailureMessage", () => {
  test("an already-registered email gets neutral wording, not outage copy", async () => {
    const thrown = await thrownBySignup(new Error("User already registered"));

    expect(signupFailureMessage(thrown)).toBe(SIGNUP_FAILED_COPY);
    expect(signupFailureMessage(thrown)).not.toMatch(/try again later/i);
  });

  test("every provider failure reads the same, so the wording never confirms an account", async () => {
    const existing = signupFailureMessage(
      await thrownBySignup(new Error("User already registered")),
    );
    const captcha = signupFailureMessage(
      await thrownBySignup(new Error("captcha verification failed")),
    );
    const limited = signupFailureMessage(await thrownBySignup(new Error("rate limit exceeded")));

    expect(captcha).toBe(existing);
    expect(limited).toBe(existing);
  });

  test("the wording points a member who has an account to log in or reset", () => {
    expect(SIGNUP_FAILED_COPY).toMatch(/log in/i);
    expect(SIGNUP_FAILED_COPY).toMatch(/reset your password/i);
  });

  test("the wording never says whether an address is registered, taken or in use", () => {
    expect(SIGNUP_FAILED_COPY).not.toMatch(/registered|taken|in use|exists|already exists/i);
  });

  test("no copy a member can read has an em-dash or en-dash", () => {
    for (const copy of [SIGNUP_FAILED_COPY, SIGNUP_NETWORK_COPY, SIGNUP_UPDATED_COPY]) {
      expect(copy).not.toMatch(/[–—]/);
    }
  });

  describe("an error that did not come from the sign-up handler", () => {
    test("a network failure says Mila could not be reached, in each browser's words", () => {
      for (const message of [
        "Failed to fetch",
        "NetworkError when attempting to fetch resource.",
        "Load failed",
        "fetch failed",
      ]) {
        expect(signupFailureMessage(new TypeError(message))).toBe(SIGNUP_NETWORK_COPY);
      }
      expect(signupFailureMessage(new TimeoutError())).toBe(SIGNUP_NETWORK_COPY);
    });

    test("the network wording is friendly and tells the member what to do", () => {
      expect(SIGNUP_NETWORK_COPY).toBe(
        "We couldn't reach Mila. Check your connection and try again.",
      );
    });

    test("a tab left open across a deploy is told to refresh", () => {
      expect(signupFailureMessage(new Error("Server function info not found for abc123"))).toBe(
        SIGNUP_UPDATED_COPY,
      );
      expect(SIGNUP_UPDATED_COPY).toBe("Mila was just updated. Refresh the page and try again.");
    });

    test("anything else gets the neutral wording, never its own raw text", () => {
      for (const raw of [
        "Internal Server Error",
        '[{"code":"invalid_string","message":"Invalid email"}]',
        "duplicate key value violates unique constraint users_email_key",
        "User already registered",
      ]) {
        const shown = signupFailureMessage(new Error(raw));
        expect(shown).toBe(SIGNUP_FAILED_COPY);
        expect(shown).not.toContain(raw);
      }
    });

    test("something thrown that is not an Error never leaks either", () => {
      expect(signupFailureMessage("boom")).toBe(SIGNUP_FAILED_COPY);
      expect(signupFailureMessage({ message: "db password is hunter2" })).toBe(SIGNUP_FAILED_COPY);
    });
  });

  test("an error with no message falls back to the neutral wording", () => {
    expect(signupFailureMessage(undefined)).toBe(SIGNUP_FAILED_COPY);
    expect(signupFailureMessage({})).toBe(SIGNUP_FAILED_COPY);
  });
});
