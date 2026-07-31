import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IN_FORCE_SUBSCRIPTION_STATUSES } from "@/constants/subscriptions";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { requireEnv } from "@/lib/env";

type MilaSupabaseClient = SupabaseClient<Database>;

export type CancelSubscriptionResult = { success: true; endsAt: string } | { error: string };
export type ResumeSubscriptionResult = { success: true; renewsAt: string } | { error: string };

export type MarkCancelAtPeriodEndStore = (
  paddleSubscriptionId: string,
  cancelAtPeriodEnd: boolean,
) => Promise<void>;

const markCancelAtPeriodEnd: MarkCancelAtPeriodEndStore = async (
  paddleSubscriptionId,
  cancelAtPeriodEnd,
) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({ cancel_at_period_end: cancelAtPeriodEnd })
    .eq("paddle_subscription_id", paddleSubscriptionId);
  if (error) console.error("[subscriptions] failed to mirror cancel_at_period_end", error);
};

async function findInForceSubscriptionId(
  db: MilaSupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("subscriptions")
    .select("paddle_subscription_id")
    .eq("user_id", userId)
    .in("status", IN_FORCE_SUBSCRIPTION_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.paddle_subscription_id;
}

export async function cancelSubscriptionForUser(
  db: MilaSupabaseClient,
  cancelViaPaddle: (
    paddleSubscriptionId: string,
  ) => Promise<{ endsAt: string } | { error: unknown }>,
  userId: string,
  markCancelAtPeriodEnd: MarkCancelAtPeriodEndStore,
): Promise<CancelSubscriptionResult> {
  const subscriptionId = await findInForceSubscriptionId(db, userId);
  if (!subscriptionId) {
    return { error: "No active membership to cancel" };
  }

  const result = await cancelViaPaddle(subscriptionId);
  if ("error" in result) {
    return { error: "Couldn't cancel your membership. Try again in a moment." };
  }
  await markCancelAtPeriodEnd(subscriptionId, true);
  return { success: true, endsAt: result.endsAt };
}

export async function resumeSubscriptionForUser(
  db: MilaSupabaseClient,
  resumeViaPaddle: (
    paddleSubscriptionId: string,
  ) => Promise<{ renewsAt: string } | { error: unknown }>,
  userId: string,
  markCancelAtPeriodEnd: MarkCancelAtPeriodEndStore,
): Promise<ResumeSubscriptionResult> {
  const subscriptionId = await findInForceSubscriptionId(db, userId);
  if (!subscriptionId) {
    return { error: "No membership to renew" };
  }

  const result = await resumeViaPaddle(subscriptionId);
  if ("error" in result) {
    return { error: "Couldn't renew your membership. Try again in a moment." };
  }
  await markCancelAtPeriodEnd(subscriptionId, false);
  return { success: true, renewsAt: result.renewsAt };
}

export async function cancelViaPaddleApi(
  paddleSubscriptionId: string,
  effectiveFrom: "next_billing_period" | "immediately" = "next_billing_period",
): Promise<{ endsAt: string } | { error: unknown }> {
  const { PADDLE_SANDBOX_API_KEY } = requireEnv({
    PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
  });

  const res = await fetch(
    `https://sandbox-api.paddle.com/subscriptions/${paddleSubscriptionId}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PADDLE_SANDBOX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ effective_from: effectiveFrom }),
    },
  );
  const json = await res.json();
  if (!res.ok) {
    console.error("[cancelMySubscription] Paddle cancel failed", json);
    return { error: json };
  }

  const endsAt: string | undefined =
    json.data?.scheduled_change?.effective_at ??
    json.data?.current_billing_period?.ends_at ??
    json.data?.canceled_at;
  if (!endsAt) {
    console.error("[cancelMySubscription] Paddle response missing an end date", json);
    return { error: json };
  }
  return { endsAt };
}

async function resumeViaPaddleApi(
  paddleSubscriptionId: string,
): Promise<{ renewsAt: string } | { error: unknown }> {
  const { PADDLE_SANDBOX_API_KEY } = requireEnv({
    PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
  });

  const res = await fetch(`https://sandbox-api.paddle.com/subscriptions/${paddleSubscriptionId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${PADDLE_SANDBOX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scheduled_change: null }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("[resumeMySubscription] Paddle update failed", json);
    return { error: json };
  }

  const renewsAt: string | undefined =
    json.data?.next_billed_at ?? json.data?.current_billing_period?.ends_at;
  if (!renewsAt) {
    console.error("[resumeMySubscription] Paddle response missing a renewal date", json);
    return { error: json };
  }
  return { renewsAt };
}

export const myMembershipStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ active: boolean }> => {
    const subscriptionId = await findInForceSubscriptionId(context.supabase, context.userId);
    return { active: !!subscriptionId };
  });

export const resumeMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResumeSubscriptionResult> =>
    resumeSubscriptionForUser(
      context.supabase,
      resumeViaPaddleApi,
      context.userId,
      markCancelAtPeriodEnd,
    ),
  );

export const cancelMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CancelSubscriptionResult> =>
    cancelSubscriptionForUser(
      context.supabase,
      cancelViaPaddleApi,
      context.userId,
      markCancelAtPeriodEnd,
    ),
  );
