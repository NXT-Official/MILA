import { createFileRoute } from "@tanstack/react-router";
import { getPaddleWebhookSecret } from "@/lib/paddle-env";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mailer } from "@/lib/mailer.server";
import {
  applyPaddleSubscriptionEvent,
  guardPaddleWebhook,
  type PaddleSubscriptionWebhookEvent,
} from "@/lib/paddle-webhook.server";
import type { CompletedTransaction } from "@/lib/purchases.server";
import { recordPurchaseAndSendReceipt } from "@/lib/receipts.server";

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
]);

const TRANSACTION_EVENT_TYPES = new Set(["transaction.completed"]);

export const Route = createFileRoute("/api/webhooks/paddle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const signature = request.headers.get("Paddle-Signature");

        let webhookSecret: string | null = null;
        try {
          webhookSecret = getPaddleWebhookSecret();
        } catch {
          // Placeholder or missing secret: answer with a reason instead of
          // letting the route die, and let Paddle retry later.
          console.error("[paddle-webhook] no webhook secret configured on this deployment");
        }

        const guard = guardPaddleWebhook({ rawBody, signature, secret: webhookSecret });
        if (!guard.ok) {
          if (guard.status >= 500) console.error("[paddle-webhook]", guard.message);
          return new Response(guard.message, { status: guard.status });
        }

        const event = JSON.parse(rawBody) as { event_type: string };
        try {
          if (SUBSCRIPTION_EVENT_TYPES.has(event.event_type)) {
            await applyPaddleSubscriptionEvent(
              supabaseAdmin,
              event as unknown as PaddleSubscriptionWebhookEvent,
            );
          } else if (TRANSACTION_EVENT_TYPES.has(event.event_type)) {
            // Money moved: record it in the ledger the admin console reads and
            // email the member their Mila receipt. The ledger insert is the
            // claim, so Paddle's retries cannot send a second receipt.
            const outcome = await recordPurchaseAndSendReceipt(
              (event as unknown as { data: CompletedTransaction }).data,
              { db: supabaseAdmin, mail: mailer() },
            );
            console.log("[paddle-webhook] transaction receipt", outcome);
          }
        } catch (err) {
          // 5xx is the retry signal: Paddle re-delivers on its own schedule and
          // surfaces the failure in the dashboard. Money already taken — never
          // answer 200 for a renewal we haven't applied.
          console.error("[paddle-webhook] event failed", event.event_type, err);
          return new Response("event failed", { status: 500 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
