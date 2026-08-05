import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { hasPermission, MODERATOR_HOME, type AppPermission } from "@/lib/authorization";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";

/** Keyed by the form the sign-in was attempted on, not by who attempted it. */
export const WRONG_TREE_NOTICE = {
  member: "Stewards and moderators sign in through the staff login.",
  staff: "The staff login is for stewards and moderators only.",
} as const;

/**
 * Undoes a sign-in that landed on the wrong login form, cache and all. Bouncing
 * the viewer onward instead would leave that form a working entry point into a
 * tree it isn't meant to open.
 */
export async function rejectWrongTreeLogin(queryClient: QueryClient, message: string) {
  await supabase.auth.signOut();
  queryClient.clear();
  toast.error(message);
}

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
      to: viewer.canAccessStaffArea ? MODERATOR_HOME : viewer.destination,
      replace: true,
    });
  }
}
