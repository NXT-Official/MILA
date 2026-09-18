import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { respondWithError } from "@/server/http/respond";
import { cancelSubscriptionForApiUser } from "@/server/services/billing";

export type HandleBillingCancelDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  cancelSubscriptionForApiUser: typeof cancelSubscriptionForApiUser;
};

const defaultDeps: HandleBillingCancelDeps = { verifyBearerAuth, cancelSubscriptionForApiUser };

/**
 * `POST /api/v1/billing/cancel` — mirrors `cancelMySubscription` in
 * `src/lib/subscriptions.functions.ts`. Schedules the caller's in-force
 * membership to end at the current billing period.
 */
export async function handleBillingCancel(
  request: Request,
  deps: HandleBillingCancelDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const result = await deps.cancelSubscriptionForApiUser(supabase, userId);
    return Response.json(result);
  } catch (error) {
    return respondWithError("billing/cancel", error);
  }
}

export const Route = createFileRoute("/api/v1/billing/cancel")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBillingCancel(request),
    },
  },
});
