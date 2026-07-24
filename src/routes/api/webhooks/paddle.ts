import { createFileRoute } from "@tanstack/react-router";
import { requireEnv } from "@/lib/env";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  applyPaddleCreditPackEvent,
  applyPaddleSubscriptionEvent,
  verifyPaddleSignature,
  type PaddleSubscriptionWebhookEvent,
  type PaddleTransactionWebhookEvent,
} from "@/lib/paddle-webhook.server";

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
        const { PADDLE_SANDBOX_WEBHOOK_SECRET } = requireEnv({
          PADDLE_SANDBOX_WEBHOOK_SECRET: process.env.PADDLE_SANDBOX_WEBHOOK_SECRET,
        });

        const rawBody = await request.text();
        const signature = request.headers.get("Paddle-Signature");
        if (!verifyPaddleSignature(rawBody, signature, PADDLE_SANDBOX_WEBHOOK_SECRET)) {
          return new Response("Invalid signature", { status: 401 });
        }

        const event = JSON.parse(rawBody) as { event_type: string };
        if (SUBSCRIPTION_EVENT_TYPES.has(event.event_type)) {
          await applyPaddleSubscriptionEvent(
            supabaseAdmin,
            event as unknown as PaddleSubscriptionWebhookEvent,
          );
        } else if (TRANSACTION_EVENT_TYPES.has(event.event_type)) {
          await applyPaddleCreditPackEvent(
            supabaseAdmin,
            event as unknown as PaddleTransactionWebhookEvent,
          );
        }

        return Response.json({ ok: true });
      },
    },
  },
});
