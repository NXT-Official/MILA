import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  applyPaddleSubscriptionEvent,
  type PaddleSubscriptionWebhookEvent,
} from "@/lib/paddle-webhook.server";
import { getPaddleApiBase } from "@/lib/paddle-env";
import { mailer } from "@/lib/mailer.server";
import { recordPurchaseAndSendReceipt } from "@/lib/receipts.server";
import type { CompletedTransaction } from "@/lib/purchases.server";

type MilaSupabaseClient = SupabaseClient<Database>;

export type PaddleApi = { get: (path: string) => Promise<Record<string, unknown>> };

export async function syncPaddleTransactionForUser(
  db: MilaSupabaseClient,
  userId: string,
  transactionId: string,
  api: PaddleApi,
  applySubscription: typeof applyPaddleSubscriptionEvent = applyPaddleSubscriptionEvent,
  recordReceipt: typeof recordPurchaseAndSendReceipt = recordPurchaseAndSendReceipt,
): Promise<{ synced: boolean }> {
  const txn = (await api.get(`/transactions/${transactionId}`)) as CompletedTransaction;

  if (txn.custom_data?.user_id !== userId) {
    console.error("[paddle-sync] transaction does not belong to the caller", { transactionId });
    return { synced: false };
  }

  // The member is standing in the app having just paid, so the receipt goes out
  // now rather than whenever the webhook lands. Both paths claim the same
  // ledger row, so whichever arrives second sends nothing.
  await recordReceipt(txn, { db, mail: mailer() });

  if (!txn.subscription_id) {
    // Memberships are the only thing we sell — a one-off transaction has nothing to apply.
    console.error("[paddle-sync] transaction has no subscription", { transactionId });
    return { synced: false };
  }

  const subscription = await api.get(`/subscriptions/${txn.subscription_id}`);
  await applySubscription(db, {
    event_type: "subscription.created",
    data: { ...subscription, custom_data: { user_id: userId } },
  } as unknown as PaddleSubscriptionWebhookEvent);
  return { synced: true };
}

export function paddleApi(apiKey: string): PaddleApi {
  return {
    get: async (path) => {
      const res = await fetch(`${getPaddleApiBase()}${path}`, {
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
