import { createFileRoute } from "@tanstack/react-router";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, ok } from "@/server/api/respond";
import {
  NO_SUBSCRIPTION_TO_CANCEL,
  cancelSubscriptionForUser,
  cancelViaPaddleApi,
} from "@/lib/subscriptions.functions";
import { markCancelAtPeriodEnd } from "@/lib/subscriptions.server";

/**
 * `POST /api/v1/billing/cancel` — cancels at the end of the paid period, never
 * immediately. The member keeps what she has already paid for, which is why
 * `cancelViaPaddleApi` defaults to `next_billing_period`.
 *
 * The subscription is found from the caller's own id, never from the body: a
 * subscription id in a request is a client-supplied string, and honouring one
 * would let anyone cancel anyone's membership.
 */
export const Route = createFileRoute("/api/v1/billing/cancel")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { supabase, user } = await requireActiveMember(request);

        const result = await cancelSubscriptionForUser(
          supabase,
          cancelViaPaddleApi,
          user.id,
          markCancelAtPeriodEnd,
        );

        if ("error" in result) {
          throw result.error === NO_SUBSCRIPTION_TO_CANCEL
            ? new ApiError("VALIDATION_FAILED", result.error, 400)
            : new ApiError("UPSTREAM_UNAVAILABLE", result.error, 503);
        }

        return ok(result);
      }),
    },
  },
});
