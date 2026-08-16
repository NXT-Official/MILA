import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { MarkCancelAtPeriodEndStore } from "./subscriptions.functions";

/** Shared with `/api/v1/billing/cancel` and `/resume`. */
export const markCancelAtPeriodEnd: MarkCancelAtPeriodEndStore = async (
  paddleSubscriptionId,
  cancelAtPeriodEnd,
) => {
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({ cancel_at_period_end: cancelAtPeriodEnd })
    .eq("paddle_subscription_id", paddleSubscriptionId);
  if (error) console.error("[subscriptions] failed to mirror cancel_at_period_end", error);
};
