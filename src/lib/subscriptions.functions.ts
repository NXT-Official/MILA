import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { requireEnv } from "@/lib/env";

type MilaSupabaseClient = SupabaseClient<Database>;

const IN_FORCE_STATUSES = ["active", "trialing", "past_due"];

export type CancelSubscriptionResult = { success: true; endsAt: string } | { error: string };

export async function cancelSubscriptionForUser(
  db: MilaSupabaseClient,
  cancelViaPaddle: (paddleSubscriptionId: string) => Promise<{ endsAt: string } | { error: unknown }>,
  userId: string,
): Promise<CancelSubscriptionResult> {
  const { data: subscription, error } = await db
    .from("subscriptions")
    .select("paddle_subscription_id")
    .eq("user_id", userId)
    .in("status", IN_FORCE_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !subscription) {
    return { error: "No active membership to cancel" };
  }

  const result = await cancelViaPaddle(subscription.paddle_subscription_id);
  if ("error" in result) {
    return { error: "Couldn't cancel your membership. Try again in a moment." };
  }
  return { success: true, endsAt: result.endsAt };
}

async function cancelViaPaddleApi(
  paddleSubscriptionId: string,
): Promise<{ endsAt: string } | { error: unknown }> {
  const { PADDLE_SANDBOX_API_KEY } = requireEnv({
    PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
  });

  const res = await fetch(
    `https://sandbox-api.paddle.com/subscriptions/${paddleSubscriptionId}/cancel`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${PADDLE_SANDBOX_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ effective_from: "next_billing_period" }),
    },
  );
  const json = await res.json();
  if (!res.ok) {
    console.error("[cancelMySubscription] Paddle cancel failed", json);
    return { error: json };
  }

  const endsAt: string | undefined =
    json.data?.scheduled_change?.effective_at ?? json.data?.current_billing_period?.ends_at;
  if (!endsAt) {
    console.error("[cancelMySubscription] Paddle response missing an end date", json);
    return { error: json };
  }
  return { endsAt };
}

export const cancelMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CancelSubscriptionResult> => {
    return cancelSubscriptionForUser(context.supabase, cancelViaPaddleApi, context.userId);
  });
