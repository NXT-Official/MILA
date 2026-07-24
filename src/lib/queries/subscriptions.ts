import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { supabase } from "@/integrations/supabase/client";
import type { BillingInterval } from "@/lib/subscription-plans";

export interface MySubscription {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  plan_title: string;
  price_amount: number;
  currency: string;
  billing_interval: BillingInterval;
}

const IN_FORCE_STATUSES = ["active", "trialing", "past_due"];

export function mySubscriptionQueryOptions(userId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.mySubscription(userId),
    queryFn: async (): Promise<MySubscription | null> => {
      if (!userId) return null;

      const { data: sub, error: subError } = await supabase
        .from("subscriptions")
        .select("plan_id, status, current_period_end, cancel_at_period_end")
        .eq("user_id", userId)
        .in("status", IN_FORCE_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (subError || !sub) return null;

      // ponytail: if an admin deactivates/archives a plan a user is still
      // subscribed to, RLS hides it here and the drawer falls back to
      // "Free" even though the subscription is real. Low-probability in a
      // 3-plan sandbox catalog; revisit if plan lifecycle management
      // becomes a real feature.
      const { data: plan, error: planError } = await supabase
        .from("subscription_plans")
        .select("title, price_amount, currency, billing_interval")
        .eq("id", sub.plan_id)
        .maybeSingle();
      if (planError || !plan) return null;

      return {
        status: sub.status,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        plan_title: plan.title,
        price_amount: plan.price_amount,
        currency: plan.currency,
        billing_interval: plan.billing_interval as BillingInterval,
      };
    },
    enabled: !!userId,
  });
}
