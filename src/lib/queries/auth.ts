import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { profileQueryOptions } from "@/lib/queries/profile";
import { queryKeys } from "@/constants/query-keys";
import { isStyleProfileComplete, toStyleProfileRow } from "@/lib/style-profile/completion";

export type AuthenticatedDestination = "/onboarding/style-profile" | "/dashboard";

/**
 * Whether her profile was actually read. "failed" (network, timeout, 5xx, a
 * read refused because her session is reconnecting) is NOT an empty profile:
 * it must never send a finished member to onboarding.
 */
export type ViewerReadStatus = "loading" | "ready" | "failed";

export interface AuthenticatedViewerState {
  status: ViewerReadStatus;
  isStyleProfileComplete: boolean;
  destination: AuthenticatedDestination;
}

export function resolveAuthenticatedDestination(input: {
  isStyleProfileComplete: boolean;
}): AuthenticatedDestination {
  return input.isStyleProfileComplete ? "/dashboard" : "/onboarding/style-profile";
}

/** What a guard does with the viewer (ruling 2026-10-07). */
export type ViewerRoute =
  /** Still reading: show the splash. */
  | "wait"
  /** The read failed: keep her where she is, with the calm try-again state. */
  | "unavailable"
  /** Read, and genuinely incomplete. */
  | "onboarding"
  /** Read, and complete. */
  | "stay";

export function routeForViewer(viewer: {
  status: ViewerReadStatus;
  isStyleProfileComplete: boolean;
}): ViewerRoute {
  if (viewer.status === "loading") return "wait";
  if (viewer.status === "failed") return "unavailable";
  return viewer.isStyleProfileComplete ? "stay" : "onboarding";
}

/**
 * Cached data wins over a failed refetch. With no data, any failed attempt,
 * now or earlier, means "failed" until a read succeeds: query-core resets a
 * data-less query to `pending` (error cleared) on every refetch and retry
 * (query.ts:710-724), so `isError` alone flickers back to "loading".
 * // src: node_modules/@tanstack/query-core/src/query.ts · 5.101.2
 */
export function viewerReadStatus(query: {
  data: unknown;
  isError: boolean;
  failureCount?: number;
  errorUpdateCount?: number;
}): ViewerReadStatus {
  if (query.data !== undefined) return "ready";
  if (query.isError || (query.failureCount ?? 0) > 0 || (query.errorUpdateCount ?? 0) > 0) {
    return "failed";
  }
  return "loading";
}

function viewerState(status: ViewerReadStatus, profile: unknown): AuthenticatedViewerState {
  const complete =
    status === "ready" &&
    isStyleProfileComplete(toStyleProfileRow(profile as Parameters<typeof toStyleProfileRow>[0]));
  return {
    status,
    isStyleProfileComplete: complete,
    // A read that did not happen never points at onboarding.
    destination:
      status === "ready"
        ? resolveAuthenticatedDestination({ isStyleProfileComplete: complete })
        : "/dashboard",
  };
}

/**
 * For route guards (`beforeLoad`). Never throws: a failed read comes back as
 * `status: "failed"` and the guard keeps her where she is; the layout then
 * shows the try-again state and its own query keeps retrying.
 */
/**
 * A route guard blocks navigation while it waits, so its read gets one quick
 * retry, not the member queries' long policy (30 tries, ~14 min while her
 * session is reconnecting). The page's own query keeps retrying after.
 */
export const GUARD_PROFILE_RETRY = { retry: 1, retryDelay: 500 } as const;

export async function loadAuthenticatedViewerState(
  queryClient: QueryClient,
  userId: string,
  client = supabase,
): Promise<AuthenticatedViewerState> {
  try {
    const profile = await queryClient.ensureQueryData({
      ...profileQueryOptions(userId, client),
      ...GUARD_PROFILE_RETRY,
    });
    return viewerState("ready", profile);
  } catch {
    return viewerState("failed", undefined);
  }
}

/**
 * A page-level Try again: read now (R-4). A query with no data that already
 * failed sleeps between retries (memberQueryRetry: up to 30 s), and a plain
 * `refetch()` only joins that sleep, since query-core cancels a running fetch
 * on refetch only when data is cached. So cancel the sleeping attempt silently
 * (no state change: the screen stays on its try-again state, never the splash)
 * and start a fresh read at once.
 * // src: node_modules/@tanstack/query-core/src/query.ts:404-419,520-560 · 5.101.2
 */
export async function readAgainNow(queryClient: QueryClient, queryKey: QueryKey): Promise<void> {
  await queryClient.cancelQueries({ queryKey, exact: true }, { revert: false, silent: true });
  await queryClient.refetchQueries({ queryKey, exact: true });
}

/** While her profile could not be read, try again on this interval (and on focus/reconnect). */
const FAILED_READ_RETRY_MS = 15_000;

export function useAuthenticatedViewerState(userId: string | undefined) {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    ...profileQueryOptions(userId),
    enabled: !!userId,
    refetchInterval: (query) =>
      query.state.status === "error" && query.state.data === undefined
        ? FAILED_READ_RETRY_MS
        : false,
  });
  const status = viewerReadStatus({
    data: profileQuery.data,
    isError: profileQuery.isError,
    failureCount: profileQuery.failureCount,
    errorUpdateCount: profileQuery.errorUpdateCount,
  });
  return {
    isLoading: profileQuery.isLoading,
    ...viewerState(status, profileQuery.data),
    // Her tap reads now; AuthReconnecting forces a fresh token refresh first.
    retry: () => {
      void readAgainNow(queryClient, queryKeys.profile(userId));
    },
  };
}
