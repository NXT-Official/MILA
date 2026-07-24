import { describe, expect, mock, test } from "bun:test";
import { cancelSubscriptionForUser } from "./subscriptions.functions";

function fakeDb(row: { paddle_subscription_id: string } | null) {
  const chain = {
    select: (..._args: unknown[]) => chain,
    eq: (..._args: unknown[]) => chain,
    in: (..._args: unknown[]) => chain,
    order: (..._args: unknown[]) => chain,
    limit: (..._args: unknown[]) => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: mock(() => chain) } as unknown as Parameters<typeof cancelSubscriptionForUser>[0];
}

describe("cancelSubscriptionForUser", () => {
  test("returns an error when the user has no in-force subscription", async () => {
    const db = fakeDb(null);
    const cancelViaPaddle = mock(async () => ({ endsAt: "2026-09-01" }));

    const result = await cancelSubscriptionForUser(db, cancelViaPaddle, "user-1");

    expect(result).toEqual({ error: "No active membership to cancel" });
    expect(cancelViaPaddle).not.toHaveBeenCalled();
  });

  test("cancels the user's subscription and returns the scheduled end date", async () => {
    const db = fakeDb({ paddle_subscription_id: "sub_123" });
    const cancelViaPaddle = mock(async () => ({ endsAt: "2026-09-01" }));

    const result = await cancelSubscriptionForUser(db, cancelViaPaddle, "user-1");

    expect(result).toEqual({ success: true, endsAt: "2026-09-01" });
    expect(cancelViaPaddle).toHaveBeenCalledWith("sub_123");
  });

  test("surfaces a generic error when Paddle's cancel call fails", async () => {
    const db = fakeDb({ paddle_subscription_id: "sub_123" });
    const cancelViaPaddle = mock(async () => ({ error: { status: 500 } }));

    const result = await cancelSubscriptionForUser(db, cancelViaPaddle, "user-1");

    expect(result).toEqual({ error: "Couldn't cancel your membership. Try again in a moment." });
  });
});
