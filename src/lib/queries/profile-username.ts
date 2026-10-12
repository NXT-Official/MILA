import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { memberAuthorization } from "@/lib/auth-session";
import { memberQueryRetry } from "@/lib/queries/member-query";

/** The signed-in member's own `@handle`; null when the profile has none yet. */
export function profileUsernameQueryOptions(userId: string | undefined, client = supabase) {
  return queryOptions({
    queryKey: ["profile-username", userId] as const,
    queryFn: async () => {
      // Read as her, never as anonymous.
      const authorization = await memberAuthorization(client.auth, userId as string);
      const { data, error } = await client
        .from("profiles")
        .select("username")
        .eq("id", userId as string)
        .maybeSingle()
        .setHeader("Authorization", authorization);
      if (error) throw error;
      return data?.username ?? null;
    },
    enabled: !!userId,
    staleTime: 5 * 60_000,
    retry: memberQueryRetry,
  });
}
