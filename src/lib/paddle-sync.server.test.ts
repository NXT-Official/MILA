import { describe, expect, mock, test } from "bun:test";
import { syncPaddleTransactionForUser, type PaddleApi } from "./paddle-sync.server";

const db = {} as never;

function fakeApi(responses: Record<string, Record<string, unknown>>): PaddleApi {
  return { get: async (path) => responses[path] ?? {} };
}

function appliers() {
  return {
    subscription: mock(async () => {}),
    creditPack: mock(async () => {}),
  } as never as { subscription: ReturnType<typeof mock>; creditPack: ReturnType<typeof mock> };
}

describe("syncPaddleTransactionForUser", () => {
  test("applies a subscription purchase through the webhook's own applier", async () => {
    const api = fakeApi({
      "/transactions/txn_1": { custom_data: { user_id: "user-1" }, subscription_id: "sub_1" },
      "/subscriptions/sub_1": { id: "sub_1", status: "active" },
    });
    const spies = appliers();

    expect(await syncPaddleTransactionForUser(db, "user-1", "txn_1", api, spies as never)).toEqual({
      synced: true,
    });
    expect(spies.creditPack).not.toHaveBeenCalled();
    const event = spies.subscription.mock.calls[0][1] as {
      data: { id: string; custom_data: { user_id: string } };
    };
    expect(event.data.id).toBe("sub_1");
    // Re-attached even when Paddle doesn't copy custom_data onto the subscription.
    expect(event.data.custom_data).toEqual({ user_id: "user-1" });
  });

  test("routes a one-off transaction to the credit pack applier", async () => {
    const api = fakeApi({
      "/transactions/txn_2": { custom_data: { user_id: "user-1" }, subscription_id: null },
    });
    const spies = appliers();

    await syncPaddleTransactionForUser(db, "user-1", "txn_2", api, spies as never);
    expect(spies.subscription).not.toHaveBeenCalled();
    expect(spies.creditPack).toHaveBeenCalledTimes(1);
  });

  test("refuses a transaction belonging to someone else", async () => {
    const api = fakeApi({
      "/transactions/txn_3": { custom_data: { user_id: "someone-else" }, subscription_id: "sub_9" },
    });
    const spies = appliers();

    expect(await syncPaddleTransactionForUser(db, "user-1", "txn_3", api, spies as never)).toEqual({
      synced: false,
    });
    expect(spies.subscription).not.toHaveBeenCalled();
    expect(spies.creditPack).not.toHaveBeenCalled();
  });
});
