import { describe, expect, mock, test } from "bun:test";
import {
  authenticateWithPassword,
  requestPasswordReset,
  updatePassword,
  type AuthDependencies,
} from "./auth-handler.server";

const credentials = {
  email: "User@Example.com",
  password: "correct-horse-battery-staple",
  captchaToken: "captcha-token",
};

function dependencies(
  result: { data: { session: unknown }; error: unknown } = {
    data: { session: { access_token: "session" } },
    error: null,
  },
) {
  const signInWithPassword = mock(async () => result);
  const signUp = mock(async () => result);
  const deps = {
    client: () => ({ auth: { signInWithPassword, signUp } }),
  } as unknown as AuthDependencies;
  return { deps, signInWithPassword, signUp };
}

describe("security-sensitive password authentication", () => {
  test("passes hCaptcha to Supabase sign-in", async () => {
    const { deps, signInWithPassword } = dependencies();
    await authenticateWithPassword("login", credentials, deps);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: credentials.email,
      password: credentials.password,
      options: { captchaToken: credentials.captchaToken },
    });
  });

  test("passes profile metadata and hCaptcha to Supabase sign-up", async () => {
    const { deps, signUp } = dependencies();
    await authenticateWithPassword("signup", { ...credentials, username: "mila_user" }, deps);
    expect(signUp).toHaveBeenCalledWith({
      email: credentials.email,
      password: credentials.password,
      options: { data: { username: "mila_user" }, captchaToken: credentials.captchaToken },
    });
  });

  test("requires CAPTCHA and returns generic provider errors", async () => {
    const { deps, signInWithPassword } = dependencies({
      data: { session: null },
      error: new Error("account does not exist"),
    });
    await expect(authenticateWithPassword("login", credentials, deps)).rejects.toThrow(
      "Email, password, or verification challenge is invalid.",
    );
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    await expect(
      authenticateWithPassword("login", { ...credentials, captchaToken: "" }, deps),
    ).rejects.toThrow();
  });
});

describe("password reset request", () => {
  function resetDeps(error: unknown = null) {
    const resetPasswordForEmail = mock(async () => ({ error }));
    const origin = mock(() => "https://mila.example.com");
    const deps = {
      client: () => ({ auth: { resetPasswordForEmail } }),
      origin,
    } as unknown as AuthDependencies;
    return { deps, resetPasswordForEmail, origin };
  }

  test("sends the recovery redirect and hCaptcha token to Supabase", async () => {
    const { deps, resetPasswordForEmail, origin } = resetDeps();
    const result = await requestPasswordReset(
      { email: "User@Example.com", captchaToken: "captcha-token" },
      deps,
    );
    expect(origin).toHaveBeenCalled();
    expect(resetPasswordForEmail).toHaveBeenCalledWith("User@Example.com", {
      redirectTo: "https://mila.example.com/auth/reset-password",
      captchaToken: "captcha-token",
    });
    expect(result).toEqual({ ok: true });
  });

  test("throws a generic error when Supabase rejects the request", async () => {
    const { deps } = resetDeps(new Error("captcha verification failed"));
    await expect(
      requestPasswordReset({ email: "user@example.com", captchaToken: "bad-token" }, deps),
    ).rejects.toThrow("Unable to send the reset link right now. Please try again later.");
  });
});

describe("password reset completion", () => {
  function updateDeps(sessionError: unknown = null, updateError: unknown = null) {
    const setSession = mock(async () => ({ error: sessionError }));
    const updateUser = mock(async () => ({ error: updateError }));
    const deps = {
      client: () => ({ auth: { setSession, updateUser } }),
    } as unknown as AuthDependencies;
    return { deps, setSession, updateUser };
  }

  const payload = {
    password: "correct-horse-battery-staple",
    accessToken: "access-token",
    refreshToken: "refresh-token",
  };

  test("hydrates the recovery session before updating the password", async () => {
    const { deps, setSession, updateUser } = updateDeps();
    const result = await updatePassword(payload, deps);
    expect(setSession).toHaveBeenCalledWith({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
    expect(updateUser).toHaveBeenCalledWith({ password: payload.password });
    expect(result).toEqual({ ok: true });
  });

  test("rejects when the recovery session is no longer valid", async () => {
    const { deps, updateUser } = updateDeps(new Error("invalid refresh token"));
    await expect(updatePassword(payload, deps)).rejects.toThrow(
      "Your reset link has expired. Please request a new one.",
    );
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("rejects when Supabase fails to update the password", async () => {
    const { deps } = updateDeps(null, new Error("weak password"));
    await expect(updatePassword(payload, deps)).rejects.toThrow(
      "Unable to update your password. Please try again.",
    );
  });
});
