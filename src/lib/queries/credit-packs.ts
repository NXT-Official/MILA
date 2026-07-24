import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { adminListCreditPacks } from "@/lib/credit-packs.functions";
import { PUBLIC_PACK_COLUMNS, type PublicCreditPack } from "@/lib/credit-packs";

export function adminCreditPacksQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.adminCreditPacks,
    queryFn: () => adminListCreditPacks(),
  });
}

export function publicCreditPacksQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.creditPacks,
    queryFn: async (): Promise<PublicCreditPack[]> => {
      const { data, error } = await supabase
        .from("credit_packs")
        .select(PUBLIC_PACK_COLUMNS)
        .eq("is_active", true)
        .is("archived_at", null)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error("Couldn't load credit packs.");
      return (data ?? []) as PublicCreditPack[];
    },
    staleTime: 60_000,
  });
}
