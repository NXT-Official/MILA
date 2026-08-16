import { createFileRoute } from "@tanstack/react-router";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, jsonBody, ok } from "@/server/api/respond";
import {
  CheckoutUrlInput,
  PLAN_NOT_PURCHASABLE,
  createCheckoutUrlForUser,
  createCheckoutViaPaddleApi,
} from "@/server/services/billing";

/**
 * `POST /api/v1/billing/checkout-url` — the one route with no website
 * counterpart.
 *
 * The browser opens Paddle's overlay in-page; a phone cannot, so it gets a
 * hosted link and opens it in a system browser instead. Card details therefore
 * never enter the app, which is what keeps it out of PCI scope.
 *
 * The returned URL is a hint, never a grant. Entitlement arrives through the
 * Paddle webhook, and nothing the phone reports about the outcome is trusted.
 */
export const Route = createFileRoute("/api/v1/billing/checkout-url")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { supabase, user } = await requireActiveMember(request);

        const parsed = CheckoutUrlInput.safeParse(await jsonBody(request));
        if (!parsed.success) {
          throw new ApiError("VALIDATION_FAILED", PLAN_NOT_PURCHASABLE, 400);
        }

        const result = await createCheckoutUrlForUser(
          supabase,
          user.id,
          parsed.data.priceId,
          createCheckoutViaPaddleApi,
        );

        if ("error" in result) {
          throw result.error === PLAN_NOT_PURCHASABLE
            ? new ApiError("VALIDATION_FAILED", result.error, 400)
            : new ApiError("UPSTREAM_UNAVAILABLE", result.error, 503);
        }

        return ok(result);
      }),
    },
  },
});
