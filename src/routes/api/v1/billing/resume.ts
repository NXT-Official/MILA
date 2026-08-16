import { createFileRoute } from "@tanstack/react-router";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, ok } from "@/server/api/respond";
import {
  NO_SUBSCRIPTION_TO_RESUME,
  resumeSubscriptionForUser,
  resumeViaPaddleApi,
} from "@/lib/subscriptions.functions";
import { markCancelAtPeriodEnd } from "@/lib/subscriptions.server";

/**
 * `POST /api/v1/billing/resume` — clears a scheduled cancellation, so the
 * membership renews as it would have. It is the exact inverse of `/cancel` and
 * finds the subscription the same way: from the caller's own id.
 */
export const Route = createFileRoute("/api/v1/billing/resume")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { supabase, user } = await requireActiveMember(request);

        const result = await resumeSubscriptionForUser(
          supabase,
          resumeViaPaddleApi,
          user.id,
          markCancelAtPeriodEnd,
        );

        if ("error" in result) {
          throw result.error === NO_SUBSCRIPTION_TO_RESUME
            ? new ApiError("VALIDATION_FAILED", result.error, 400)
            : new ApiError("UPSTREAM_UNAVAILABLE", result.error, 503);
        }

        return ok(result);
      }),
    },
  },
});
