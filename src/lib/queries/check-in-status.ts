import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { getCheckInStatus, type CheckInStatus } from "@/lib/check-in.functions";
import { memberQueryRetry } from "@/lib/queries/member-query";

/** The server answers fresh prices; 30 seconds is enough to cover a
 * re-render without hiding a claimed free check-in for long. */
export const CHECK_IN_STATUS_STALE_MS = 30_000;

export type FetchCheckInStatus = () => Promise<CheckInStatus>;

/**
 * What Today's check-in and the body scan cost her right now
 * (`getCheckInStatus`). `available: false` means the Wave D migration is not
 * applied (or her row could not be read): every entry point hides itself.
 * Pass `useServerFn(getCheckInStatus)` from a component; the default calls the
 * server function directly.
 */
export function checkInStatusQueryOptions(
  userId: string | undefined,
  fetchStatus: FetchCheckInStatus = () => getCheckInStatus(),
) {
  return queryOptions({
    queryKey: queryKeys.checkInStatus(userId),
    queryFn: () => fetchStatus(),
    enabled: !!userId,
    staleTime: CHECK_IN_STATUS_STALE_MS,
    retry: memberQueryRetry,
  });
}
