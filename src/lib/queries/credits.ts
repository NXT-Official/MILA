import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/constants/query-keys";

export function creditsQueryOptions(userId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.credits(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from("user_entitlements")
        .select("ai_credits, purchased_credits")
        .eq("user_id", userId as string)
        .maybeSingle();

      return (data?.ai_credits ?? 0) + (data?.purchased_credits ?? 0);
    },
    enabled: !!userId,
  });
}
