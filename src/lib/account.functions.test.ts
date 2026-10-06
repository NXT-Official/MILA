import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  deleteAccountForUser,
  supabaseDeleteAccountDeps,
  type DeleteAccountDeps,
} from "./account.functions";

function fakeDb(
  subscription: { paddle_subscription_id: string } | null,
  lookupError: { message: string } | null = null,
) {
  const chain = {
    select: (..._args: unknown[]) => chain,
    eq: (..._args: unknown[]) => chain,
    in: (..._args: unknown[]) => chain,
    order: (..._args: unknown[]) => chain,
    limit: (..._args: unknown[]) => chain,
    maybeSingle: async () => ({ data: lookupError ? null : subscription, error: lookupError }),
  };
  return { from: mock(() => chain) } as unknown as Parameters<typeof deleteAccountForUser>[0];
}

function fakeDeps(overrides: Partial<DeleteAccountDeps> = {}) {
  return {
    getEmail: mock(async () => "member@example.com"),
    getProfileName: mock(async () => "Nadia Haddad"),
    cancelSubscription: mock(async () => true),
    purgeStorage: mock(async () => {}),
    deleteUser: mock(async () => true),
    notifyAccountDeleted: mock(async () => {}),
    ...overrides,
  };
}

describe("deleteAccountForUser", () => {
  test("deletes the user, their files, and their billing", async () => {
    const deps = fakeDeps();
    const result = await deleteAccountForUser(
      fakeDb({ paddle_subscription_id: "sub_123" }),
      "user-1",
      "member@example.com",
      deps,
    );

    expect(result).toEqual({ success: true });
    expect(deps.cancelSubscription).toHaveBeenCalledWith("sub_123");
    expect(deps.purgeStorage).toHaveBeenCalledWith("user-1");
    expect(deps.deleteUser).toHaveBeenCalledWith("user-1");
  });

  test("accepts the typed email regardless of case and padding", async () => {
    const deps = fakeDeps();
    const result = await deleteAccountForUser(
      fakeDb(null),
      "user-1",
      "  MEMBER@Example.com ",
      deps,
    );

    expect(result).toEqual({ success: true });
    expect(deps.deleteUser).toHaveBeenCalled();
  });

  test("a mismatched email deletes nothing", async () => {
    const deps = fakeDeps();
    const result = await deleteAccountForUser(fakeDb(null), "user-1", "someone@else.com", deps);

    expect(result).toEqual({
      error: "That email doesn't match the account you're signed in to.",
    });
    expect(deps.purgeStorage).not.toHaveBeenCalled();
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  test("keeps the account when billing can't be stopped", async () => {
    // Otherwise the card keeps getting charged with no account left to log into.
    const deps = fakeDeps({ cancelSubscription: mock(async () => false) });
    const result = await deleteAccountForUser(
      fakeDb({ paddle_subscription_id: "sub_123" }),
      "user-1",
      "member@example.com",
      deps,
    );

    expect(result).toEqual({
      error: "We couldn't stop your billing just now, so nothing was deleted. Please try again.",
    });
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  test("a user with no subscription skips Paddle entirely", async () => {
    const deps = fakeDeps();
    await deleteAccountForUser(fakeDb(null), "user-1", "member@example.com", deps);

    expect(deps.cancelSubscription).not.toHaveBeenCalled();
    expect(deps.deleteUser).toHaveBeenCalled();
  });

  test("reports a failed auth delete", async () => {
    const deps = fakeDeps({ deleteUser: mock(async () => false) });
    const result = await deleteAccountForUser(fakeDb(null), "user-1", "member@example.com", deps);

    expect(result).toEqual({
      error: "We couldn't delete your account just now. Please try again.",
    });
  });

  test("emails a record of the deletion to the address that was just removed", async () => {
    const deps = fakeDeps();
    await deleteAccountForUser(fakeDb(null), "user-1", "member@example.com", deps);

    expect(deps.notifyAccountDeleted).toHaveBeenCalledWith({
      email: "member@example.com",
      name: "Nadia Haddad",
    });
  });

  test("a failed delete sends no farewell and a failing notice never fails the delete", async () => {
    const failed = fakeDeps({ deleteUser: mock(async () => false) });
    await deleteAccountForUser(fakeDb(null), "user-1", "member@example.com", failed);
    expect(failed.notifyAccountDeleted).not.toHaveBeenCalled();

    const crashing = fakeDeps({
      notifyAccountDeleted: mock(async () => {
        throw new Error("resend unreachable");
      }),
    });
    expect(
      await deleteAccountForUser(fakeDb(null), "user-1", "member@example.com", crashing),
    ).toEqual({ success: true });
  });
});

describe("deleteAccountForUser with a plan staff granted", () => {
  // Granted plans carry synthetic ids and have no Paddle subscription behind
  // them, so there is nothing to cancel and Paddle must never be called.
  test.each(["manual:5b0e6a9c-1f7d-4c58-9f3e-2f4a6f0c8d11", "manual_comp_demo"])(
    "skips Paddle for %s and deletes the account",
    async (grantedId) => {
      const deps = fakeDeps();
      const result = await deleteAccountForUser(
        fakeDb({ paddle_subscription_id: grantedId }),
        "user-1",
        "member@example.com",
        deps,
      );

      expect(result).toEqual({ success: true });
      expect(deps.cancelSubscription).not.toHaveBeenCalled();
      expect(deps.purgeStorage).toHaveBeenCalledWith("user-1");
      expect(deps.deleteUser).toHaveBeenCalledWith("user-1");
    },
  );
});

describe("deleteAccountForUser never throws", () => {
  const CONFIG_TEXT = "Missing environment variable(s): PADDLE_SANDBOX_API_KEY. Set them in .env";
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test("billing that throws keeps the account and says billing couldn't be stopped", async () => {
    const deps = fakeDeps({
      cancelSubscription: mock(async () => {
        throw new Error(CONFIG_TEXT);
      }),
    });
    const result = await deleteAccountForUser(
      fakeDb({ paddle_subscription_id: "sub_123" }),
      "user-1",
      "member@example.com",
      deps,
    );

    expect(result).toEqual({
      error: "We couldn't stop your billing just now, so nothing was deleted. Please try again.",
    });
    expect(deps.purgeStorage).not.toHaveBeenCalled();
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  test("the real Paddle call with no API key configured never leaks the config message", async () => {
    const saved = {
      PADDLE_ENV: process.env.PADDLE_ENV,
      PADDLE_API_KEY: process.env.PADDLE_API_KEY,
      PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
    };
    delete process.env.PADDLE_ENV;
    delete process.env.PADDLE_API_KEY;
    delete process.env.PADDLE_SANDBOX_API_KEY;
    try {
      const deps = fakeDeps({ cancelSubscription: supabaseDeleteAccountDeps.cancelSubscription });
      const result = await deleteAccountForUser(
        fakeDb({ paddle_subscription_id: "sub_123" }),
        "user-1",
        "member@example.com",
        deps,
      );

      expect(result).toEqual({
        error: "We couldn't stop your billing just now, so nothing was deleted. Please try again.",
      });
      expect(JSON.stringify(result)).not.toMatch(/PADDLE|environment variable/i);
      expect(deps.deleteUser).not.toHaveBeenCalled();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test.each([
    ["the email lookup", { getEmail: mock(async () => Promise.reject(new Error("db down"))) }],
    ["the storage purge", { purgeStorage: mock(async () => Promise.reject(new Error("boom"))) }],
    ["the account delete", { deleteUser: mock(async () => Promise.reject(new Error("boom"))) }],
  ] as const)("a throw in %s comes back as a friendly error", async (_step, override) => {
    const result = await deleteAccountForUser(
      fakeDb(null),
      "user-1",
      "member@example.com",
      fakeDeps(override),
    );

    expect(result).toEqual({
      error: "We couldn't delete your account just now. Please try again.",
    });
  });

  test("a failed membership lookup deletes nothing rather than skipping billing", async () => {
    // Treating a lookup error as "no membership" would delete the account and
    // leave a paid plan billing.
    const deps = fakeDeps();
    const result = await deleteAccountForUser(
      fakeDb(null, { message: "permission denied for table subscriptions" }),
      "user-1",
      "member@example.com",
      deps,
    );

    expect(result).toEqual({
      error: "We couldn't delete your account just now. Please try again.",
    });
    expect(deps.cancelSubscription).not.toHaveBeenCalled();
    expect(deps.purgeStorage).not.toHaveBeenCalled();
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });
});
