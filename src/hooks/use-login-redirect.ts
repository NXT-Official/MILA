import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState } from "@/lib/queries/auth";
import { rejectWrongTreeLogin, WRONG_TREE_NOTICE } from "@/lib/staff-route";

/**
 * Sends a signed-in viewer on from a login screen — and refuses the sign-in
 * outright when it happened on the wrong form. The member login is not a staff
 * entry point, and the staff login is not a back door into the member app.
 */
export function useLoginRedirect(tree: "member" | "staff") {
  const { session, loading } = useAuth();
  const viewer = useAuthenticatedViewerState(session?.user.id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Null until the first settled render: was this page opened already signed in?
  const arrivedSignedIn = useRef<boolean | null>(null);

  // Both staff roles belong to /staff, so the split is staff access, not admin.
  const wrongForm = tree === "staff" ? !viewer.canAccessStaffArea : viewer.canAccessStaffArea;

  useEffect(() => {
    if (loading || viewer.isLoading) return;
    if (arrivedSignedIn.current === null) arrivedSignedIn.current = !!session;
    if (!session) return;
    // Only a sign-in performed *here* is rejected; someone passing through with
    // a live session keeps it and is just sent home.
    if (wrongForm && !arrivedSignedIn.current) {
      const sendTo = tree === "staff" ? "/login" : "/staff";
      void rejectWrongTreeLogin(queryClient, WRONG_TREE_NOTICE[tree]).then(() =>
        navigate({ to: sendTo, replace: true }),
      );
      return;
    }
    navigate({ to: viewer.destination });
  }, [
    tree,
    wrongForm,
    loading,
    session,
    viewer.isLoading,
    viewer.destination,
    navigate,
    queryClient,
  ]);
}
