import { queryOptions } from "@tanstack/react-query";
import {
  IN_FORCE_SUBSCRIPTION_STATUSES,
  isStaffGrantedSubscription,
  isSubscriptionLive,
} from "@/constants/subscriptions";
import { queryKeys } from "@/constants/query-keys";
import { supabase } from "@/integrations/supabase/client";
import type { BillingInterval } from "@/lib/subscription-plans";

export interface MySubscription {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  plan_title: string;
  credits_included: number;
  price_amount: number;
  currency: string;
  billing_interval: BillingInterval;
  /**
   * True when staff granted this plan by hand: it isn't billed through Paddle,
   * so the drawer shows it as granted instead of offering cancel/resume.
   */
  is_staff_granted: boolean;
}

export function mySubscriptionQueryOptions(userId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.mySubscription(userId),
    queryFn: async (): Promise<MySubscription | null> => {
      if (!userId) return null;

      const { data: sub, error: subError } = await supabase
        .from("subscriptions")
        .select("plan_id, status, current_period_end, cancel_at_period_end, paddle_subscription_id")
        .eq("user_id", userId)
        .in("status", IN_FORCE_SUBSCRIPTION_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // A subscription whose paid period has run out is over even before the
      // daily sweep flips its status, so the drawer must not keep showing it as
      // an active membership.
      if (subError || !sub || !isSubscriptionLive(sub)) return null;

      const { data: plan, error: planError } = await supabase
        .from("subscription_plans")
        .select("title, credits_included, price_amount, currency, billing_interval")
        .eq("id", sub.plan_id)
        .maybeSingle();
      if (planError || !plan) return null;

      return {
        status: sub.status,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        plan_title: plan.title,
        credits_included: plan.credits_included,
        price_amount: plan.price_amount,
        currency: plan.currency,
        billing_interval: plan.billing_interval as BillingInterval,
        is_staff_granted: isStaffGrantedSubscription(sub.paddle_subscription_id),
      };
    },
    enabled: !!userId,
  });
}
