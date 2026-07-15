import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { adminListSubscriptionPlans } from "@/lib/subscription-plans.functions";
import {
  normalizePlanFeatures,
  PUBLIC_PLAN_COLUMNS,
  type PublicSubscriptionPlan,
} from "@/lib/subscription-plans";

export function adminSubscriptionPlansQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.adminSubscriptionPlans,
    queryFn: () => adminListSubscriptionPlans(),
  });
}

export function publicSubscriptionPlansQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.subscriptionPlans,
    queryFn: async (): Promise<PublicSubscriptionPlan[]> => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select(PUBLIC_PLAN_COLUMNS)
        .eq("is_active", true)
        .is("archived_at", null)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error("Couldn't load membership plans.");
      return ((data ?? []) as PublicSubscriptionPlan[]).map((plan) => ({
        ...plan,
        features: normalizePlanFeatures(plan.features),
      }));
    },
    staleTime: 60_000,
  });
}
