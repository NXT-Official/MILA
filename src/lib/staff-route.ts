import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hasPermission, type AppPermission } from "@/lib/authorization";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";

export async function requireStaffRoutePermission(
  queryClient: QueryClient,
  permission: AppPermission,
) {
  if (typeof window === "undefined") return;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  const viewer = await loadAuthenticatedViewerState(queryClient, userId);
  if (!hasPermission(viewer.roles, permission)) {
    throw redirect({
      to: viewer.canAccessStaffArea ? "/admin/moderation" : viewer.destination,
      replace: true,
    });
  }
}
