import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { IN_FORCE_SUBSCRIPTION_STATUSES, isSubscriptionLive } from "@/constants/subscriptions";
import { supabase } from "@/integrations/supabase/client";
import { effectiveCredits, utcDay } from "@/lib/credits";

export function creditsQueryOptions(userId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.credits(userId),
    queryFn: async () => {
      const { data: entitlement } = await supabase
        .from("user_entitlements")
        .select("ai_credits, purchased_credits, credits_reset_at")
        .eq("user_id", userId as string)
        .maybeSingle();

      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("plan_id, status, current_period_end, cancel_at_period_end")
        .eq("user_id", userId as string)
        .in("status", IN_FORCE_SUBSCRIPTION_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // The plan's allowance is only owed while the subscription is live, and
      // it is only in `ai_credits` once the day has been reset — see
      // effectiveCredits.
      let planAllowance: number | null = null;
      if (subscription && isSubscriptionLive(subscription)) {
        const { data: plan } = await supabase
          .from("subscription_plans")
          .select("credits_included")
          .eq("id", subscription.plan_id)
          .maybeSingle();
        planAllowance = plan?.credits_included ?? null;
      }

      return effectiveCredits({
        aiCredits: entitlement?.ai_credits ?? 0,
        purchasedCredits: entitlement?.purchased_credits ?? 0,
        creditsResetAt: entitlement?.credits_reset_at ?? null,
        planAllowance,
        today: utcDay(),
      });
    },
    enabled: !!userId,
  });
}
