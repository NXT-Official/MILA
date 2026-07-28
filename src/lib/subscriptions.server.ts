import type { MarkCancelAtPeriodEndStore } from "./subscriptions.functions";

export const markCancelAtPeriodEnd: MarkCancelAtPeriodEndStore = async (
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
