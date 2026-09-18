import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { respondWithError } from "@/server/http/respond";
import { resumeSubscriptionForApiUser } from "@/server/services/billing";

export type HandleBillingResumeDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  resumeSubscriptionForApiUser: typeof resumeSubscriptionForApiUser;
};

const defaultDeps: HandleBillingResumeDeps = { verifyBearerAuth, resumeSubscriptionForApiUser };

/**
 * `POST /api/v1/billing/resume` — mirrors `resumeMySubscription` in
 * `src/lib/subscriptions.functions.ts`. Clears a scheduled cancellation and
 * resumes the caller's membership.
 */
export async function handleBillingResume(
  request: Request,
  deps: HandleBillingResumeDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const result = await deps.resumeSubscriptionForApiUser(supabase, userId);
    return Response.json(result);
  } catch (error) {
    return respondWithError("billing/resume", error);
  }
}

export const Route = createFileRoute("/api/v1/billing/resume")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBillingResume(request),
    },
  },
});
