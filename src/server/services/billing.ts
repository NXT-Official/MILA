import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireEnv } from "@/lib/env";

type MilaSupabaseClient = SupabaseClient<Database>;

const PADDLE_API = "https://sandbox-api.paddle.com";

export const CheckoutUrlInput = z.object({ priceId: z.string().min(1).max(128) });

export type CheckoutUrlResult = { url: string } | { error: string };

export const PLAN_NOT_PURCHASABLE = "That plan isn't available right now.";

export type CreateCheckoutViaPaddle = (input: {
  priceId: string;
  userId: string;
}) => Promise<{ url: string } | { error: unknown }>;

/**
 * Mint a Paddle-hosted checkout link for one plan.
 *
 * The website never needs this — it opens the Paddle.js overlay in the browser
 * and sets `customData` there. A phone has no overlay, so the URL is minted
 * here instead, and that relocation is the whole security point:
 * **`custom_data.user_id` is set from the verified caller and is never read
 * from the request body.** It is the key the webhook attributes the payment
 * by, so a client-supplied one would let anyone credit a purchase to any
 * account.
 *
 * The plan lookup runs through the **caller's own client**, so the
 * "Authenticated view active plans" policy (`is_active AND archived_at IS
 * NULL`) does the filtering. An archived or draft plan simply returns no row —
 * there is no second copy of that rule here to drift from the database's.
 */
export async function createCheckoutUrlForUser(
  db: MilaSupabaseClient,
  userId: string,
  priceId: string,
  createCheckout: CreateCheckoutViaPaddle,
): Promise<CheckoutUrlResult> {
  const { data: plan } = await db
    .from("subscription_plans")
    .select("paddle_price_id")
    // `paddle_price_id` carries no unique constraint, so this stays a limited
    // lookup rather than a single-row assertion that a duplicate would break.
    .eq("paddle_price_id", priceId)
    .limit(1)
    .maybeSingle();

  if (!plan?.paddle_price_id) {
    return { error: PLAN_NOT_PURCHASABLE };
  }

  const result = await createCheckout({ priceId: plan.paddle_price_id, userId });
  if ("error" in result) {
    return { error: "Checkout couldn't be opened. Try again in a moment." };
  }
  return { url: result.url };
}

/**
 * `POST /transactions` returns a payment link at `data.checkout.url` — the
 * default payment URL configured in the Paddle dashboard, plus `?_ptxn=<id>`.
 *
 * ponytail: `checkout.url` is deliberately not sent, so the dashboard's default
 * payment link wins. Paddle only accepts an approved web domain there, never a
 * custom scheme, so `mila://checkout-return` cannot be passed here — the
 * app-return redirect is checkout-settings configuration, not a field on this
 * call.
 */
export const createCheckoutViaPaddleApi: CreateCheckoutViaPaddle = async ({ priceId, userId }) => {
  const { PADDLE_SANDBOX_API_KEY } = requireEnv({
    PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
  });

  const res = await fetch(`${PADDLE_API}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PADDLE_SANDBOX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      custom_data: { user_id: userId },
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("[billing/checkout-url] Paddle transaction failed", json);
    return { error: json };
  }

  const url: string | undefined = json.data?.checkout?.url;
  if (!url) {
    console.error("[billing/checkout-url] Paddle response carried no checkout URL", json);
    return { error: json };
  }
  return { url };
};
