import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { hasPermission, type AppPermission } from "@/lib/authorization";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";

/** Every login form in the app; each accepts exactly one kind of viewer. */
export type LoginTree = "member" | "admin" | "moderator";

/** Keyed by the form the sign-in was attempted on, not by who attempted it. */
export const WRONG_TREE_NOTICE = {
  // Stays generic on the member form — naming a staff login leaks it to anyone
  // who tries staff credentials here.
  member: "We couldn't sign you in with those details.",
  admin: "This sign-in is for stewards only.",
  moderator: "This sign-in is for moderators only.",
} as const satisfies Record<LoginTree, string>;

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
    // destination already resolves to the viewer's own tree — sending a steward
    // to MODERATOR_HOME here would bounce them off a door they can't open.
    throw redirect({ to: viewer.destination, replace: true });
  }
}
