import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { requireEnv } from "@/lib/env";

type MilaSupabaseClient = SupabaseClient<Database>;

const IN_FORCE_STATUSES = ["active", "trialing", "past_due"];

export type CancelSubscriptionResult = { success: true; endsAt: string } | { error: string };

export type ResumeSubscriptionResult = { success: true; renewsAt: string } | { error: string };

export type MarkCancelAtPeriodEndStore = (
  paddleSubscriptionId: string,
  cancelAtPeriodEnd: boolean,
) => Promise<void>;

/**
 * The subscription.updated webhook is the source of truth for this flag and
 * will set it again with the same value — but it arrives whenever it arrives
 * (never, without a tunnel in local dev), and until it does the drawer keeps
 * saying "Renews" and offering a Cancel button for a membership Paddle has
 * already scheduled for cancellation. Writing it here makes the UI honest the
 * moment Paddle confirms. Only the flag: current_period_end stays the
 * webhook's business.
 */
const supabaseMarkCancelAtPeriodEnd: MarkCancelAtPeriodEndStore = async (
  paddleSubscriptionId,
  cancelAtPeriodEnd,
) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({ cancel_at_period_end: cancelAtPeriodEnd })
    .eq("paddle_subscription_id", paddleSubscriptionId);
  // Paddle already accepted the change — don't fail the user's request over a
  // mirror write the webhook will redo anyway.
  if (error) console.error("[subscriptions] failed to mirror cancel_at_period_end", error);
};

/** The membership a cancel or renew acts on: newest row that's still in force. */
async function findInForceSubscriptionId(
  db: MilaSupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("subscriptions")
    .select("paddle_subscription_id")
    .eq("user_id", userId)
    .in("status", IN_FORCE_STATUSES)
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
  markCancelAtPeriodEnd: MarkCancelAtPeriodEndStore = supabaseMarkCancelAtPeriodEnd,
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

/**
 * Undoes a scheduled cancellation. A subscription winding down is still
 * `active` with a scheduled_change, so this is not Paddle's "resume" operation
 * (that one is for `paused` subscriptions) — it's an update that clears the
 * scheduled change, which is the only value that field accepts.
 */
export async function resumeSubscriptionForUser(
  db: MilaSupabaseClient,
  resumeViaPaddle: (
    paddleSubscriptionId: string,
  ) => Promise<{ renewsAt: string } | { error: unknown }>,
  userId: string,
  markCancelAtPeriodEnd: MarkCancelAtPeriodEndStore = supabaseMarkCancelAtPeriodEnd,
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

  // An immediate cancel comes back already `canceled` with no scheduled change,
  // so canceled_at is the only date left to report.
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
    // null is the only value this field accepts on update, and it means
    // "drop the pending cancellation".
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

export const resumeMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResumeSubscriptionResult> => {
    return resumeSubscriptionForUser(context.supabase, resumeViaPaddleApi, context.userId);
  });

export const cancelMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CancelSubscriptionResult> => {
    return cancelSubscriptionForUser(context.supabase, cancelViaPaddleApi, context.userId);
  });
