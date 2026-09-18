import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { SyncPaddlePurchaseInput } from "@/lib/paddle-sync.functions";
import { syncPurchaseForUser } from "@/server/services/billing";

export type HandleBillingSyncDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  syncPurchaseForUser: typeof syncPurchaseForUser;
};

const defaultDeps: HandleBillingSyncDeps = { verifyBearerAuth, syncPurchaseForUser };

/**
 * `POST /api/v1/billing/sync` — mirrors `syncPaddlePurchase` in
 * `src/lib/paddle-sync.functions.ts`. Confirms a just-completed Paddle
 * transaction belongs to the caller and applies its subscription, the same
 * reconciliation the web checkout flow runs after `checkout.completed`.
 */
export async function handleBillingSync(
  request: Request,
  deps: HandleBillingSyncDeps = defaultDeps,
): Promise<Response> {
  try {
    const { userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const input = SyncPaddlePurchaseInput.parse(body);

    const result = await deps.syncPurchaseForUser(userId, input.transactionId);
    return Response.json(result);
  } catch (error) {
    return respondWithError("billing/sync", error);
  }
}

export const Route = createFileRoute("/api/v1/billing/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBillingSync(request),
    },
  },
});
