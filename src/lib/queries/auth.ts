import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { profileQueryOptions } from "@/lib/queries/profile";
import { isStyleProfileComplete, toStyleProfileRow } from "@/lib/style-profile/completion";

export type AuthenticatedDestination = "/onboarding/style-profile" | "/dashboard";

export interface AuthenticatedViewerState {
  isStyleProfileComplete: boolean;
  destination: AuthenticatedDestination;
}

export function resolveAuthenticatedDestination(input: {
  isStyleProfileComplete: boolean;
}): AuthenticatedDestination {
  return input.isStyleProfileComplete ? "/dashboard" : "/onboarding/style-profile";
}

export async function loadAuthenticatedViewerState(
  queryClient: QueryClient,
  userId: string,
): Promise<AuthenticatedViewerState> {
  const profile = await queryClient.ensureQueryData(profileQueryOptions(userId));
  const complete = isStyleProfileComplete(toStyleProfileRow(profile));
  return {
    isStyleProfileComplete: complete,
    destination: resolveAuthenticatedDestination({ isStyleProfileComplete: complete }),
  };
}

export function useAuthenticatedViewerState(userId: string | undefined) {
  const profileQuery = useQuery({ ...profileQueryOptions(userId), enabled: !!userId });
  const complete = isStyleProfileComplete(toStyleProfileRow(profileQuery.data));
  return {
    isLoading: profileQuery.isLoading,
    isStyleProfileComplete: complete,
    destination: resolveAuthenticatedDestination({ isStyleProfileComplete: complete }),
  };
}
