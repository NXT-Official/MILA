import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getPaddleApiBase, getPaddleApiKey } from "@/lib/paddle-env";
import {
  cancelSubscriptionForUser,
  cancelViaPaddleApi,
  markCancelAtPeriodEnd,
  resumeSubscriptionForUser,
  resumeViaPaddleApi,
} from "@/lib/subscriptions.functions";
import { DomainValidationError, UpstreamUnavailableError } from "@/server/http/api-errors";

type MilaSupabaseClient = SupabaseClient<Database>;

export type CheckoutUrlInputData = { planId: string };

/**
 * Creates a Paddle hosted-checkout transaction for one plan and returns its
 * URL. Mobile has no Paddle.js overlay to drive checkout with (that's a
 * browser-only SDK — see `src/hooks/use-paddle-checkout.ts` for the web
 * equivalent), so `POST /api/v1/billing/checkout-url` hands back a URL the
 * app opens in an in-app browser / system browser instead. There is no prior
 * web server-side equivalent to mirror; this is new.
 */
export async function getCheckoutUrlForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: CheckoutUrlInputData,
  customerEmail?: string | null,
): Promise<{ checkoutUrl: string }> {
  const { data: plan, error } = await supabase
    .from("subscription_plans")
    .select("paddle_price_id")
    .eq("id", data.planId)
    .eq("is_active", true)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!plan?.paddle_price_id) {
    throw new DomainValidationError("That plan isn't available for checkout.");
  }

  const paddleApiKey = getPaddleApiKey();

  const res = await fetch(`${getPaddleApiBase()}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${paddleApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ price_id: plan.paddle_price_id, quantity: 1 }],
      custom_data: { user_id: userId },
      ...(customerEmail ? { customer: { email: customerEmail } } : {}),
    }),
  });
  const json = (await res.json()) as {
    data?: { checkout?: { url?: string } };
  };
  if (!res.ok) {
    console.error("[billing/checkout-url] Paddle transaction create failed", json);
    throw new UpstreamUnavailableError("Couldn't start checkout. Please try again.");
  }

  const checkoutUrl = json.data?.checkout?.url;
  if (!checkoutUrl) {
    console.error("[billing/checkout-url] Paddle response missing a checkout url", json);
    throw new UpstreamUnavailableError("Couldn't start checkout. Please try again.");
  }
  return { checkoutUrl };
}

/**
 * Confirms a just-completed Paddle transaction belongs to this caller and
 * applies its subscription — the same reconciliation the web's
 * `syncPaddlePurchase` server function performs after `checkout.completed`
 * fires. Shared verbatim; extracted from `src/lib/paddle-sync.functions.ts`.
 */
export async function syncPurchaseForUser(
  userId: string,
  transactionId: string,
): Promise<{ synced: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { syncPaddleTransactionForUser, paddleApi } = await import("@/lib/paddle-sync.server");
  return syncPaddleTransactionForUser(
    supabaseAdmin,
    userId,
    transactionId,
    paddleApi(getPaddleApiKey()),
  );
}

/**
 * Cancels the caller's in-force membership (scheduled for period end).
 * `cancelSubscriptionForUser` (in `src/lib/subscriptions.functions.ts`) is
 * already the shared, dependency-injected business logic — this is the thin
 * exception-based adapter `/api/v1/billing/cancel` needs on top of it,
 * mirroring the `account/delete` adapter.
 */
export async function cancelSubscriptionForApiUser(
  supabase: MilaSupabaseClient,
  userId: string,
): Promise<{ success: true; endsAt: string }> {
  const result = await cancelSubscriptionForUser(
    supabase,
    cancelViaPaddleApi,
    userId,
    markCancelAtPeriodEnd,
  );
  if ("error" in result) throw new DomainValidationError(result.error);
  return result;
}

/**
 * Clears a scheduled cancellation and resumes the caller's membership. See
 * {@link cancelSubscriptionForApiUser}.
 */
export async function resumeSubscriptionForApiUser(
  supabase: MilaSupabaseClient,
  userId: string,
): Promise<{ success: true; renewsAt: string }> {
  const result = await resumeSubscriptionForUser(
    supabase,
    resumeViaPaddleApi,
    userId,
    markCancelAtPeriodEnd,
  );
  if ("error" in result) throw new DomainValidationError(result.error);
  return result;
}
