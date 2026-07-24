import { createFileRoute } from "@tanstack/react-router";
import { requireEnv } from "@/lib/env";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  applyPaddleSubscriptionEvent,
  verifyPaddleSignature,
  type PaddleSubscriptionWebhookEvent,
} from "@/lib/paddle-webhook.server";

const HANDLED_EVENT_TYPES = new Set(["subscription.created", "subscription.updated", "subscription.canceled"]);

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

        const event = JSON.parse(rawBody) as PaddleSubscriptionWebhookEvent;
        if (HANDLED_EVENT_TYPES.has(event.event_type)) {
          await applyPaddleSubscriptionEvent(supabaseAdmin, event);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
