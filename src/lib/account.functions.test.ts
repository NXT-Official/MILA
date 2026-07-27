import { describe, expect, mock, test } from "bun:test";
import { deleteAccountForUser, type DeleteAccountDeps } from "./account.functions";

function fakeDb(subscription: { paddle_subscription_id: string } | null) {
  const chain = {
    select: (..._args: unknown[]) => chain,
    eq: (..._args: unknown[]) => chain,
    in: (..._args: unknown[]) => chain,
    order: (..._args: unknown[]) => chain,
    limit: (..._args: unknown[]) => chain,
    maybeSingle: async () => ({ data: subscription, error: null }),
  };
  return { from: mock(() => chain) } as unknown as Parameters<typeof deleteAccountForUser>[0];
}

function fakeDeps(overrides: Partial<DeleteAccountDeps> = {}) {
  return {
    getEmail: mock(async () => "member@example.com"),
    cancelSubscription: mock(async () => true),
    purgeStorage: mock(async () => {}),
    deleteUser: mock(async () => true),
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
});
