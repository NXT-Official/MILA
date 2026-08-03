import { describe, expect, mock, test } from "bun:test";
import { syncPaddleTransactionForUser, type PaddleApi } from "./paddle-sync.server";

const db = {} as never;

function fakeApi(responses: Record<string, Record<string, unknown>>): PaddleApi {
  return { get: async (path) => responses[path] ?? {} };
}

describe("syncPaddleTransactionForUser", () => {
  test("applies a subscription purchase through the webhook's own applier", async () => {
    const api = fakeApi({
      "/transactions/txn_1": { custom_data: { user_id: "user-1" }, subscription_id: "sub_1" },
      "/subscriptions/sub_1": { id: "sub_1", status: "active" },
    });
    const applySubscription = mock(async () => {});

    expect(
      await syncPaddleTransactionForUser(db, "user-1", "txn_1", api, applySubscription as never),
    ).toEqual({ synced: true });
    const event = applySubscription.mock.calls[0][1] as {
      data: { id: string; custom_data: { user_id: string } };
    };
    expect(event.data.id).toBe("sub_1");
    // Re-attached even when Paddle doesn't copy custom_data onto the subscription.
    expect(event.data.custom_data).toEqual({ user_id: "user-1" });
  });

  test("ignores a one-off transaction — memberships are all we sell", async () => {
    const api = fakeApi({
      "/transactions/txn_2": { custom_data: { user_id: "user-1" }, subscription_id: null },
    });
    const applySubscription = mock(async () => {});

    expect(
      await syncPaddleTransactionForUser(db, "user-1", "txn_2", api, applySubscription as never),
    ).toEqual({ synced: false });
    expect(applySubscription).not.toHaveBeenCalled();
  });

  test("refuses a transaction belonging to someone else", async () => {
    const api = fakeApi({
      "/transactions/txn_3": { custom_data: { user_id: "someone-else" }, subscription_id: "sub_9" },
    });
    const applySubscription = mock(async () => {});

    expect(
      await syncPaddleTransactionForUser(db, "user-1", "txn_3", api, applySubscription as never),
    ).toEqual({ synced: false });
    expect(applySubscription).not.toHaveBeenCalled();
  });
});
