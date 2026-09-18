import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { getCheckoutUrlForUser } from "@/server/services/billing";

const CheckoutUrlInput = z.object({ planId: z.string().uuid() });

export type HandleBillingCheckoutUrlDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  getCheckoutUrlForUser: typeof getCheckoutUrlForUser;
};

const defaultDeps: HandleBillingCheckoutUrlDeps = { verifyBearerAuth, getCheckoutUrlForUser };

/**
 * `POST /api/v1/billing/checkout-url` — creates a Paddle hosted-checkout
 * transaction for `planId` (a `subscription_plans.id`) and returns its URL
 * for the mobile app to open in an in-app/system browser. There is no
 * mobile-side API client for billing yet (MILA_MOBILE's `MembershipScreen`
 * explicitly defers checkout/cancel/resume to a pending product decision —
 * see its doc comment), so this contract is new rather than mirrored from an
 * existing mobile call site.
 */
export async function handleBillingCheckoutUrl(
  request: Request,
  deps: HandleBillingCheckoutUrlDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId, claims } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const input = CheckoutUrlInput.parse(body);

    const email = typeof claims.email === "string" ? claims.email : null;
    const result = await deps.getCheckoutUrlForUser(supabase, userId, input, email);
    return Response.json(result);
  } catch (error) {
    return respondWithError("billing/checkout-url", error);
  }
}

export const Route = createFileRoute("/api/v1/billing/checkout-url")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBillingCheckoutUrl(request),
    },
  },
});
