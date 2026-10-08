import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reapGenerationJobs } from "@/lib/generation-jobs.server";
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
  /** Fails + refunds every generation job past its deadline (R7). Runs after
   * the sweep and never fails it; `available: false` until the
   * generation_jobs migration is applied. */
  reap?: () => Promise<{ available: boolean; reaped: number }>;
};

type GenerationJobsReap = { available: boolean; reaped: number; error?: "reap_failed" };

async function reapSafely(
  reap: NonNullable<HandleMembershipMaintenanceDeps["reap"]>,
): Promise<GenerationJobsReap> {
  try {
    return await reap();
  } catch (error) {
    console.error("[membership-maintenance] generation job reaper failed", error);
    return { available: true, reaped: 0, error: "reap_failed" };
  }
}

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
 *
 * It then reaps generation jobs (R7): any job still running 30 s past its
 * deadline (its server was ended mid-generation) is failed and its credit
 * refunded, for every member. Reported as `generationJobs` in the summary.
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
    if (!deps.reap) return Response.json(summary);
    return Response.json({ ...summary, generationJobs: await reapSafely(deps.reap) });
  } catch (error) {
    console.error("[membership-maintenance] sweep failed", error);
    // A failed membership sweep must not also keep members' stuck credits.
    if (deps.reap) await reapSafely(deps.reap);
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
          reap: () => reapGenerationJobs(null),
        }),
    },
  },
});
