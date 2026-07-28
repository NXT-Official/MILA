import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { staffGateQueryOptions } from "@/lib/queries/admin";
import { hasPermission, type AppPermission, type AppRole } from "@/lib/authorization";
import { profileQueryOptions } from "@/lib/queries/profile";
import { isStyleProfileComplete, toStyleProfileRow } from "@/lib/style-profile/completion";

export type AuthenticatedDestination = "/admin" | "/onboarding/style-profile" | "/dashboard";

export interface AuthenticatedViewerState {
  isAdmin: boolean;
  isModerator: boolean;
  canAccessStaffArea: boolean;
  roles: AppRole[];
  permissions: AppPermission[];
  isStyleProfileComplete: boolean;
  destination: AuthenticatedDestination;
}

export function resolveAuthenticatedDestination(input: {
  isAdmin: boolean;
  canAccessStaffArea?: boolean;
  isStyleProfileComplete: boolean;
}): AuthenticatedDestination {
  if (input.isAdmin || input.canAccessStaffArea) return "/admin";
  if (!input.isStyleProfileComplete) return "/onboarding/style-profile";
  return "/dashboard";
}

export async function loadAuthenticatedViewerState(
  queryClient: QueryClient,
  userId: string,
): Promise<AuthenticatedViewerState> {
  const [gate, profile] = await Promise.all([
    queryClient.ensureQueryData(staffGateQueryOptions()),
    queryClient.ensureQueryData(profileQueryOptions(userId)),
  ]);
  const isAdmin = !!gate?.is_admin;
  const roles = gate?.roles ?? [];
  const permissions = gate?.permissions ?? [];
  const canAccessStaffArea = !!gate?.can_access_staff_area;
  const complete = isStyleProfileComplete(toStyleProfileRow(profile));
  return {
    isAdmin,
    isModerator: !!gate?.is_moderator,
    canAccessStaffArea,
    roles,
    permissions,
    isStyleProfileComplete: complete,
    destination: resolveAuthenticatedDestination({
      isAdmin,
      canAccessStaffArea,
      isStyleProfileComplete: complete,
    }),
  };
}

export function useAuthenticatedViewerState(userId: string | undefined) {
  const gateQuery = useQuery({ ...staffGateQueryOptions(), enabled: !!userId });
  const profileQuery = useQuery({ ...profileQueryOptions(userId), enabled: !!userId });
  const isAdmin = !!gateQuery.data?.is_admin;
  const roles = gateQuery.data?.roles ?? [];
  const permissions = gateQuery.data?.permissions ?? [];
  const canAccessStaffArea = !!gateQuery.data?.can_access_staff_area;
  const complete = isStyleProfileComplete(toStyleProfileRow(profileQuery.data));
  return {
    isLoading: gateQuery.isLoading || profileQuery.isLoading,
    isAdmin,
    isModerator: !!gateQuery.data?.is_moderator,
    canAccessStaffArea,
    roles,
    permissions,
    hasPermission: (permission: AppPermission) => hasPermission(roles, permission),
    isStyleProfileComplete: complete,
    destination: resolveAuthenticatedDestination({
      isAdmin,
      canAccessStaffArea,
      isStyleProfileComplete: complete,
    }),
  };
}
