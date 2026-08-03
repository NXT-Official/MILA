import { createFileRoute } from "@tanstack/react-router";
import { requireEnv } from "@/lib/env";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  applyPaddleSubscriptionEvent,
  verifyPaddleSignature,
  type PaddleSubscriptionWebhookEvent,
} from "@/lib/paddle-webhook.server";

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
]);

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
        try {
          if (SUBSCRIPTION_EVENT_TYPES.has(event.event_type)) {
            await applyPaddleSubscriptionEvent(
              supabaseAdmin,
              event as unknown as PaddleSubscriptionWebhookEvent,
            );
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
