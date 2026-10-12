import { describe, expect, mock, test } from "bun:test";
import {
  authRequestOrigin,
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
    // The deployment she is on (a preview here), as the server sees the request.
    origin: () => "https://mila-nicoledev.vercel.app",
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
      options: {
        data: { username: "mila_user" },
        captchaToken: credentials.captchaToken,
        emailRedirectTo: "https://mila-nicoledev.vercel.app/auth/callback?next=%2Fdashboard",
      },
    });
  });

  test("the confirmation email returns her to the deployment she signed up on, and to her page", async () => {
    // Without emailRedirectTo Supabase uses the Site URL: the live site, even
    // when she signed up on a preview.
    const { deps, signUp } = dependencies();
    await authenticateWithPassword(
      "signup",
      { ...credentials, username: "mila_user", next: "/history?look=abc" },
      deps,
    );
    const options = (
      signUp.mock.calls[0] as unknown as [{ options: { emailRedirectTo: string } }]
    )[0].options;
    expect(options.emailRedirectTo).toBe(
      "https://mila-nicoledev.vercel.app/auth/callback?next=%2Fhistory%3Flook%3Dabc",
    );
  });

  test("an unsafe return path in the sign-up request falls back to the dashboard", async () => {
    const { deps, signUp } = dependencies();
    await authenticateWithPassword(
      "signup",
      { ...credentials, username: "mila_user", next: "//evil.example" },
      deps,
    );
    const options = (
      signUp.mock.calls[0] as unknown as [{ options: { emailRedirectTo: string } }]
    )[0].options;
    expect(options.emailRedirectTo).toBe(
      "https://mila-nicoledev.vercel.app/auth/callback?next=%2Fdashboard",
    );
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
    const setSession = mock(async () => ({
      data: { session: { access_token: "access-token" }, user: { id: "user-1" } },
      error: sessionError,
    }));
    const updateUser = mock(async () => ({ error: updateError }));
    const notifyPasswordChanged = mock(async () => {});
    const deps = {
      client: () => ({ auth: { setSession, updateUser } }),
      notifyPasswordChanged,
    } as unknown as AuthDependencies;
    return { deps, setSession, updateUser, notifyPasswordChanged };
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

  test("tells the member their password changed", async () => {
    const { deps, notifyPasswordChanged } = updateDeps();
    await updatePassword(payload, deps);
    expect(notifyPasswordChanged).toHaveBeenCalledWith("user-1");
  });

  test("a failing notice never fails the password change", async () => {
    const { deps } = updateDeps();
    const crashing = {
      ...deps,
      notifyPasswordChanged: mock(async () => {
        throw new Error("resend unreachable");
      }),
    } as unknown as AuthDependencies;

    expect(await updatePassword(payload, crashing)).toEqual({ ok: true });
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

describe("auth redirect origin from the request (host-header injection)", () => {
  const env = { NODE_ENV: "production" };

  test("a forged Host header never becomes the link in her email", () => {
    expect(
      authRequestOrigin({ originHeader: undefined, requestUrlOrigin: "https://evil.example" }, env),
    ).toBe("https://milafashion.site");
  });

  test("a forged Origin header never becomes the link either", () => {
    expect(
      authRequestOrigin(
        { originHeader: "https://evil.example", requestUrlOrigin: "https://evil.example" },
        env,
      ),
    ).toBe("https://milafashion.site");
  });

  test("a real Mila deployment is kept", () => {
    expect(
      authRequestOrigin(
        {
          originHeader: "https://mila-nicoledev.vercel.app",
          requestUrlOrigin: "https://mila-nicoledev.vercel.app",
        },
        env,
      ),
    ).toBe("https://mila-nicoledev.vercel.app");
  });
});

describe("the request's own host wins over the Origin header (N-4)", () => {
  test("a forged Origin naming the other deployment cannot redirect a live request", () => {
    expect(
      authRequestOrigin(
        {
          originHeader: "https://mila-nicoledev.vercel.app",
          requestUrlOrigin: "https://mila-umber.vercel.app",
        },
        { NODE_ENV: "production" },
      ),
    ).toBe("https://mila-umber.vercel.app");
  });
});
