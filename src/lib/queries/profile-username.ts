import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** The signed-in member's own `@handle`; null when the profile has none yet. */
export function profileUsernameQueryOptions(userId: string | undefined) {
  return queryOptions({
    queryKey: ["profile-username", userId] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId as string)
        .maybeSingle();
      if (error) throw error;
      return data?.username ?? null;
    },
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
}
