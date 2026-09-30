import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPaddleApiKey } from "@/lib/paddle-env";
import { paddleApi } from "@/lib/paddle-sync.server";
import type { PaddleSubscriptionWebhookEvent } from "@/lib/paddle-webhook.server";
import {
  runMembershipMaintenance,
  type MembershipMaintenanceSummary,
} from "@/server/services/membership-maintenance";

export type HandleMembershipMaintenanceDeps = {
  /** Vercel sends `Authorization: Bearer $CRON_SECRET`; unset means the route can't be trusted to run. */
  secret: string | undefined;
  run: () => Promise<MembershipMaintenanceSummary>;
};

function matchesSecret(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * `GET /api/v1/cron/membership-maintenance` — the daily sweep, run by Vercel
 * Cron (see `vercel.json`). Gives every live subscriber today's styling credits
 * and takes ended subscriptions out of force, so a membership that stopped
 * paying stops accruing. The response is the summary, which is what the cron
 * logs show.
 */
export async function handleMembershipMaintenance(
  request: Request,
  deps: HandleMembershipMaintenanceDeps,
): Promise<Response> {
  if (!deps.secret) {
    // Refusing beats running unauthenticated: this route writes credits and
    // membership state for every member, so an open door is worse than a sweep
    // that doesn't run until CRON_SECRET is set.
    console.error("[membership-maintenance] CRON_SECRET is not set — sweep skipped");
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }

  if (!matchesSecret(request.headers.get("authorization"), deps.secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const summary = await deps.run();
    if (summary.errors.length > 0) {
      console.error("[membership-maintenance] finished with errors", summary.errors);
    }
    return Response.json(summary);
  } catch (error) {
    console.error("[membership-maintenance] sweep failed", error);
    return Response.json({ error: "sweep failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/v1/cron/membership-maintenance")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        handleMembershipMaintenance(request, {
          secret: process.env.CRON_SECRET,
          run: () =>
            runMembershipMaintenance({
              db: supabaseAdmin,
              fetchSubscription: async (subscriptionId) => {
                const api = paddleApi(getPaddleApiKey());
                const subscription = await api.get(`/subscriptions/${subscriptionId}`);
                return subscription as unknown as PaddleSubscriptionWebhookEvent["data"];
              },
            }),
        }),
    },
  },
});
