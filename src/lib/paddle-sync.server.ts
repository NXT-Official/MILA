import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  applyPaddleCreditPackEvent,
  applyPaddleSubscriptionEvent,
  type PaddleSubscriptionWebhookEvent,
  type PaddleTransactionWebhookEvent,
} from "@/lib/paddle-webhook.server";

type MilaSupabaseClient = SupabaseClient<Database>;

// ponytail: sandbox host, same as subscriptions.functions.ts. One env-driven
// base URL when a production Paddle account exists.
const PADDLE_API = "https://sandbox-api.paddle.com";

export type PaddleApi = { get: (path: string) => Promise<Record<string, unknown>> };

export type SyncAppliers = {
  subscription: typeof applyPaddleSubscriptionEvent;
  creditPack: typeof applyPaddleCreditPackEvent;
};

/**
 * Replays a completed checkout against the same code the webhook uses.
 *
 * The webhook is still the system of record, but it can't reach a dev machine
 * and it can be slow or dropped in production — either way the customer has
 * paid and is staring at a UI that shows nothing. Both appliers are idempotent,
 * so whichever arrives second is a no-op.
 */
export async function syncPaddleTransactionForUser(
  db: MilaSupabaseClient,
  userId: string,
  transactionId: string,
  api: PaddleApi,
  appliers: SyncAppliers = {
    subscription: applyPaddleSubscriptionEvent,
    creditPack: applyPaddleCreditPackEvent,
  },
): Promise<{ synced: boolean }> {
  const txn = (await api.get(`/transactions/${transactionId}`)) as {
    custom_data?: { user_id?: string } | null;
    subscription_id?: string | null;
  };

  // Only ever sync your own purchase — the transaction id comes from the client.
  if (txn.custom_data?.user_id !== userId) {
    console.error("[paddle-sync] transaction does not belong to the caller", { transactionId });
    return { synced: false };
  }

  if (txn.subscription_id) {
    const subscription = await api.get(`/subscriptions/${txn.subscription_id}`);
    await appliers.subscription(db, {
      event_type: "subscription.created",
      // custom_data is re-attached from the transaction we just verified, in
      // case Paddle didn't copy it onto the subscription itself.
      data: { ...subscription, custom_data: { user_id: userId } },
    } as unknown as PaddleSubscriptionWebhookEvent);
    return { synced: true };
  }

  await appliers.creditPack(db, {
    event_type: "transaction.completed",
    data: txn,
  } as unknown as PaddleTransactionWebhookEvent);
  return { synced: true };
}

export function paddleApi(apiKey: string): PaddleApi {
  return {
    get: async (path) => {
      const res = await fetch(`${PADDLE_API}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const json = await res.json();
      if (!res.ok) {
        console.error("[paddle-sync] Paddle API error", path, json);
        throw new Error("Paddle lookup failed");
      }
      return json.data as Record<string, unknown>;
    },
  };
}
