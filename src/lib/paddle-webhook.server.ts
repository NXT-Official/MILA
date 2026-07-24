import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function parseSignatureHeader(header: string): { ts?: string; h1?: string } {
  const parsed: Record<string, string> = {};
  for (const segment of header.split(";")) {
    const [key, value] = segment.split("=");
    if (key && value) parsed[key.trim()] = value.trim();
  }
  return parsed;
}

export function verifyPaddleSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const { ts, h1 } = parseSignatureHeader(header);
  if (!ts || !h1) return false;

  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(h1, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}

type MilaSupabaseClient = SupabaseClient<Database>;

export type PaddleSubscriptionWebhookEvent = {
  event_type: "subscription.created" | "subscription.updated" | "subscription.canceled";
  data: {
    id: string;
    customer_id: string;
    status: string;
    current_billing_period: { ends_at: string } | null;
    scheduled_change: { action: string } | null;
    items: Array<{ price: { id: string } }>;
    custom_data: { user_id?: string } | null;
  };
};

const IN_FORCE_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function applyPaddleSubscriptionEvent(
  db: MilaSupabaseClient,
  event: PaddleSubscriptionWebhookEvent,
): Promise<void> {
  const { data } = event;
  const userId = data.custom_data?.user_id;
  if (!userId) {
    console.error("[paddle-webhook] missing custom_data.user_id", { subscriptionId: data.id });
    return;
  }

  const priceId = data.items[0]?.price.id;
  const { data: plan, error: planError } = await db
    .from("subscription_plans")
    .select("id, credits_included")
    .eq("paddle_price_id", priceId ?? "")
    .maybeSingle();
  if (planError || !plan) {
    console.error("[paddle-webhook] unknown paddle price id", { priceId, subscriptionId: data.id });
    return;
  }

  const { data: existing } = await db
    .from("subscriptions")
    .select("current_period_end")
    .eq("paddle_subscription_id", data.id)
    .maybeSingle();

  const newPeriodEnd = data.current_billing_period?.ends_at ?? null;
  const isRenewal =
    newPeriodEnd !== null &&
    (existing?.current_period_end == null ||
      new Date(newPeriodEnd).getTime() > new Date(existing.current_period_end).getTime());

  const { error: upsertError } = await db.from("subscriptions").upsert(
    {
      user_id: userId,
      plan_id: plan.id,
      paddle_subscription_id: data.id,
      paddle_customer_id: data.customer_id,
      status: data.status,
      current_period_end: newPeriodEnd,
      cancel_at_period_end: data.scheduled_change?.action === "cancel",
    },
    { onConflict: "paddle_subscription_id" },
  );
  if (upsertError) {
    console.error("[paddle-webhook] failed to upsert subscription", upsertError);
    return;
  }

  await db
    .from("profiles")
    .update({ paddle_customer_id: data.customer_id })
    .eq("id", userId)
    .is("paddle_customer_id", null);

  const inForce = IN_FORCE_STATUSES.has(data.status);
  const entitlementUpdate: { ads_removed: boolean; ai_credits?: number } = {
    ads_removed: inForce,
  };
  if (inForce && isRenewal) entitlementUpdate.ai_credits = plan.credits_included;

  const { error: entitlementError } = await db
    .from("user_entitlements")
    .update(entitlementUpdate)
    .eq("user_id", userId);
  if (entitlementError) {
    console.error("[paddle-webhook] failed to sync entitlements", entitlementError);
  }
}
