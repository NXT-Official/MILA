import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState } from "@/lib/queries/auth";
import { rejectWrongTreeLogin, WRONG_TREE_NOTICE, type LoginTree } from "@/lib/staff-route";

/**
 * Sends a signed-in viewer on from a login screen — and refuses the sign-in
 * outright when it happened on the wrong form. Each tree owns one form and
 * accepts only its own role: the member login is not a staff entry point, the
 * steward login is not a moderator entry point, and vice versa.
 */
export function useLoginRedirect(tree: LoginTree) {
  const { session, loading } = useAuth();
  const viewer = useAuthenticatedViewerState(session?.user.id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Null until the first settled render: was this page opened already signed in?
  const arrivedSignedIn = useRef<boolean | null>(null);

  // Exact role, not permission: an admin holds every moderator permission but
  // still doesn't belong on the moderator form, and vice versa.
  const belongsHere = {
    member: !viewer.canAccessStaffArea,
    admin: viewer.isAdmin,
    moderator: viewer.isModerator,
  }[tree];

  useEffect(() => {
    if (loading || viewer.isLoading) return;
    if (arrivedSignedIn.current === null) arrivedSignedIn.current = !!session;
    if (!session) return;
    // Only a sign-in performed *here* is rejected; someone passing through with
    // a live session keeps it and is just sent home.
    if (!belongsHere && !arrivedSignedIn.current) {
      void rejectWrongTreeLogin(queryClient, WRONG_TREE_NOTICE[tree]).then(() => {
        // A refused staff sign-in lands on the public homepage — the same place
        // an unauthenticated deep link into either tree ends up. The member form
        // keeps the viewer where they are so they can simply try again.
        if (tree !== "member") navigate({ to: "/", replace: true });
      });
      return;
    }
    navigate({ to: viewer.destination });
  }, [
    tree,
    belongsHere,
    loading,
    session,
    viewer.isLoading,
    viewer.destination,
    navigate,
    queryClient,
  ]);
}
