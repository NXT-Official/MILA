import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { IN_FORCE_SUBSCRIPTION_STATUSES, isSubscriptionLive } from "@/constants/subscriptions";
import { supabase } from "@/integrations/supabase/client";
import { memberAuthorization } from "@/lib/auth-session";
import { effectiveCredits, utcDay } from "@/lib/credits";
import { memberQueryRetry } from "@/lib/queries/member-query";

export function creditsQueryOptions(userId: string | undefined, client = supabase) {
  return queryOptions({
    queryKey: queryKeys.credits(userId),
    queryFn: async () => {
      // Every read goes out as her, never as anonymous: an anonymous read sees
      // no entitlement row and would show "0 credits" over her real balance.
      const authorization = await memberAuthorization(client.auth, userId as string);

      const { data: entitlement, error: entitlementError } = await client
        .from("user_entitlements")
        .select("ai_credits, purchased_credits, credits_reset_at")
        .eq("user_id", userId as string)
        .maybeSingle()
        .setHeader("Authorization", authorization);
      // A failed read keeps the last balance on screen (React Query keeps the
      // data); it must never turn into "0 credits".
      if (entitlementError) throw entitlementError;

      const { data: subscription, error: subscriptionError } = await client
        .from("subscriptions")
        .select("plan_id, status, current_period_end, cancel_at_period_end")
        .eq("user_id", userId as string)
        .in("status", IN_FORCE_SUBSCRIPTION_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .setHeader("Authorization", authorization);
      if (subscriptionError) throw subscriptionError;

      // The plan's allowance is only owed while the subscription is live, and
      // it is only in `ai_credits` once the day has been reset — see
      // effectiveCredits.
      let planAllowance: number | null = null;
      if (subscription && isSubscriptionLive(subscription)) {
        const { data: plan, error: planError } = await client
          .from("subscription_plans")
          .select("credits_included")
          .eq("id", subscription.plan_id)
          .maybeSingle()
          .setHeader("Authorization", authorization);
        if (planError) throw planError;
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
    retry: memberQueryRetry,
  });
}
