import { describe, expect, mock, test } from "bun:test";
import type { Session } from "@supabase/supabase-js";
import { SIGNUP_FAILED_COPY, SIGNUP_NETWORK_COPY } from "./auth-errors";
import { completeSignup, signupRequest, type SignupSteps } from "./signup-flow";
import { SIGNUP_SIGN_IN_FAILED_COPY } from "./signup-outcome";

const SESSION = { access_token: "token", user: { id: "u1" } } as Session;

function steps(overrides: Partial<SignupSteps> = {}) {
  const startSession = mock(async (_session: Session) => ({ error: null as unknown }));
  const trackSignup = mock(async (_session: Session) => {});
  const createAccount = mock(async () => ({ session: SESSION as Session | null }));
  const all: SignupSteps = { createAccount, startSession, trackSignup, ...overrides };
  return { all, createAccount, startSession, trackSignup };
}

describe("completeSignup", () => {
  test("a refused sign-up says so, with the neutral wording, and goes no further", async () => {
    const { all, startSession, trackSignup } = steps({
      createAccount: async () => {
        throw new Error("Unable to create the account. Please try again later.");
      },
    });

    expect(await completeSignup(all)).toEqual({ status: "failed", message: SIGNUP_FAILED_COPY });
    expect(startSession).not.toHaveBeenCalled();
    expect(trackSignup).not.toHaveBeenCalled();
  });

  test("a dropped connection while creating the account is a failure that says so", async () => {
    const { all } = steps({
      createAccount: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    expect(await completeSignup(all)).toEqual({ status: "failed", message: SIGNUP_NETWORK_COPY });
  });

  test("a member with a session is signed in, counted, and welcomed", async () => {
    const { all, startSession, trackSignup } = steps();

    const outcome = await completeSignup(all);

    expect(outcome).toEqual({
      status: "created",
      message: "Welcome to Mila. Let's build your style profile.",
    });
    expect(startSession).toHaveBeenCalledWith(SESSION);
    expect(trackSignup).toHaveBeenCalledWith(SESSION);
  });

  test("a project that needs email confirmation tells the member to check their inbox", async () => {
    const { all, startSession, trackSignup } = steps({
      createAccount: async () => ({ session: null }),
    });

    expect(await completeSignup(all)).toEqual({
      status: "created",
      message: "Studio profile created. Check your inbox to confirm.",
    });
    expect(startSession).not.toHaveBeenCalled();
    expect(trackSignup).not.toHaveBeenCalled();
  });

  test("failing to start the session AFTER the account exists never says it could not be created", async () => {
    const { all, trackSignup } = steps({
      startSession: async () => {
        throw new Error("storage is unavailable");
      },
    });

    const outcome = await completeSignup(all);

    expect(outcome).toEqual({ status: "created", message: SIGNUP_SIGN_IN_FAILED_COPY });
    expect(trackSignup).not.toHaveBeenCalled();
  });

  test("a session the client refuses (setSession returns an error) is the same as a throw", async () => {
    const { all } = steps({ startSession: async () => ({ error: new Error("bad token") }) });

    expect(await completeSignup(all)).toEqual({
      status: "created",
      message: SIGNUP_SIGN_IN_FAILED_COPY,
    });
  });

  test("an analytics failure never changes what the member is told", async () => {
    const rejecting = steps({
      trackSignup: async () => {
        throw new Error("analytics down");
      },
    });
    const throwing = steps({
      trackSignup: () => {
        throw new Error("analytics down, synchronously");
      },
    });

    for (const { all } of [rejecting, throwing]) {
      expect(await completeSignup(all)).toEqual({
        status: "created",
        message: "Welcome to Mila. Let's build your style profile.",
      });
    }
  });

  test("the welcome does not wait for analytics", async () => {
    const { all } = steps({ trackSignup: () => new Promise<void>(() => {}) });

    expect((await completeSignup(all)).status).toBe("created");
  });
});

describe("signupRequest", () => {
  const values = { email: "a@example.com", password: "Correct-horse-9", username: "mila_user" };

  test("carries her safe return path so the confirmation email brings her back to it", () => {
    expect(signupRequest(values, "captcha", "/history?look=abc")).toEqual({
      ...values,
      captchaToken: "captcha",
      next: "/history?look=abc",
    });
  });

  test("an unsafe or missing return path is left out (the server then uses the dashboard)", () => {
    expect(signupRequest(values, "captcha", "//evil.example")).toEqual({
      ...values,
      captchaToken: "captcha",
    });
    expect(signupRequest(values, "captcha", undefined)).toEqual({
      ...values,
      captchaToken: "captcha",
    });
  });
});
