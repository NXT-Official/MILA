import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { queryKeys } from "@/constants/query-keys";
import { findSimilarItems, type DupeMatch } from "@/lib/dupe-hunter.functions";
import type { PostItem } from "@/lib/outfit-items";
import { useAuth } from "@/hooks/use-auth";
import { profileQueryOptions } from "@/lib/queries/profile";

const MATCH_CACHE_MS = 24 * 60 * 60 * 1000;

export type FetchSimilar = (args: {
  data: { attributes: PostItem["attributes"]; region: string | undefined };
}) => Promise<DupeMatch[]>;

export interface SimilarItemsInputs {
  region: string | undefined;
  /** True once her profile has answered (success or error), or there is no profile to wait for. */
  settled: boolean;
}

/**
 * One definition for the Shop tab and the prefetch. The region is part of the
 * key and nothing runs before the profile settles, so a region-less result is
 * never cached for a member who has a delivery country.
 */
export function similarItemsQueryOptions(
  item: PostItem,
  fetchSimilar: FetchSimilar,
  { region, settled }: SimilarItemsInputs,
) {
  return {
    queryKey: queryKeys.similarItems(item.id, region ?? null),
    queryFn: () => fetchSimilar({ data: { attributes: item.attributes, region } }),
    enabled: settled,
    staleTime: MATCH_CACHE_MS,
    gcTime: MATCH_CACHE_MS,
  };
}

/** Warm the Shop tab's query when the drawer opens. No-op without an item or before the profile settles. */
export function prefetchSimilarItems(
  queryClient: QueryClient,
  item: PostItem | null,
  fetchSimilar: FetchSimilar,
  inputs: SimilarItemsInputs,
): Promise<void> {
  if (!item || !inputs.settled) return Promise.resolve();
  // src: https://tanstack.com/query/latest/docs/framework/react/guides/prefetching
  return queryClient.prefetchQuery(similarItemsQueryOptions(item, fetchSimilar, inputs));
}

export type SimilarShopView = "loading" | "error" | "empty" | "results";

/** Which Shop tab surface to show. Empty only after a successful zero-result search; a disabled or pending query is loading. */
export function similarShopView(state: {
  settled: boolean;
  status: "pending" | "error" | "success";
  count: number;
}): SimilarShopView {
  if (!state.settled || state.status === "pending") return "loading";
  if (state.status === "error") return "error";
  return state.count === 0 ? "empty" : "results";
}

/** The server fn plus the region/settled inputs, read from her profile query. */
export function useSimilarItemsInputs(): { fetchSimilar: FetchSimilar } & SimilarItemsInputs {
  const fetchSimilar = useServerFn(findSimilarItems) as FetchSimilar;
  const { user, loading } = useAuth();
  const { data: profile, status } = useQuery({
    ...profileQueryOptions(user?.id),
    enabled: !!user,
  });
  return {
    fetchSimilar,
    region: profile?.delivery_country || undefined,
    settled: !loading && (!user || status !== "pending"),
  };
}
