import { describe, expect, mock, test } from "bun:test";
import { authenticateWithPassword, type AuthDependencies } from "./auth-handler.server";

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
