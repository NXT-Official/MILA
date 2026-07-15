import { describe, expect, mock, test } from "bun:test";
import { authenticateWithPassword, type AuthDependencies } from "./auth-handler.server";
import { RateLimitExceededError } from "./rate-limit.server";

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
  const consumed: Array<[string, string]> = [];
  const consume = mock(async (namespace: string, identity: string) => {
    consumed.push([namespace, identity]);
  });
  const deps = {
    ip: () => "203.0.113.4",
    consume,
    key: mock(() => "hashed-account-key"),
    client: () => ({ auth: { signInWithPassword, signUp } }),
  } as unknown as AuthDependencies;
  return { deps, consume, consumed, signInWithPassword, signUp };
}

describe("security-sensitive password authentication", () => {
  test("enforces IP and account limits before sign-in and passes hCaptcha to Supabase", async () => {
    const { deps, consumed, signInWithPassword } = dependencies();
    await authenticateWithPassword("login", credentials, deps);
    expect(consumed.map(([namespace]) => namespace)).toEqual([
      "auth:login:ip",
      "auth:login:account",
    ]);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: credentials.email,
      password: credentials.password,
      options: { captchaToken: credentials.captchaToken },
    });
  });

  test("blocks before Supabase when either limiter rejects", async () => {
    for (const blockedCall of [1, 2]) {
      const { deps, consume, signInWithPassword } = dependencies();
      consume.mockImplementation(async () => {
        if (consume.mock.calls.length === blockedCall) throw new RateLimitExceededError(30);
      });
      await expect(authenticateWithPassword("login", credentials, deps)).rejects.toBeInstanceOf(
        RateLimitExceededError,
      );
      expect(signInWithPassword).not.toHaveBeenCalled();
    }
  });

  test("sign-up uses separate policies, a hashed account identity, and CAPTCHA", async () => {
    const { deps, consumed, signUp } = dependencies();
    await authenticateWithPassword("signup", { ...credentials, username: "mila_user" }, deps);
    expect(consumed[1]?.[1]).toBe("hashed-account-key");
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

  test("does not call Supabase when no runtime IP is available", async () => {
    const { deps, signInWithPassword } = dependencies();
    deps.ip = () => undefined;
    await expect(authenticateWithPassword("login", credentials, deps)).rejects.toThrow(
      "Unable to verify",
    );
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
