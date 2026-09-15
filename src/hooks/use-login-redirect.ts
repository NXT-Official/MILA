import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState } from "@/lib/queries/auth";

/** Sends a signed-in viewer on from the login screen to their destination. */
export function useLoginRedirect() {
  const { session, loading } = useAuth();
  const viewer = useAuthenticatedViewerState(session?.user.id);
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || viewer.isLoading || !session) return;
    navigate({ to: viewer.destination });
  }, [loading, session, viewer.isLoading, viewer.destination, navigate]);
}
