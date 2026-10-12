import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { routeForViewer, useAuthenticatedViewerState } from "@/lib/queries/auth";
import { postLoginDestination } from "@/lib/safe-redirect";

/**
 * Sends a signed-in viewer on from the login screen to their destination: an
 * unfinished style profile first, otherwise the page they were sent here from
 * (`returnTo`, re-checked as a same-origin path), otherwise the dashboard.
 */
export function useLoginRedirect(returnTo?: string) {
  const { session, loading } = useAuth();
  // Keyed on the id, not the session object: a token refresh must not re-run it.
  const userId = session?.user.id;
  const viewer = useAuthenticatedViewerState(userId);
  const route = routeForViewer(viewer);
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !userId) return;
    // Only a profile that was actually read decides: a failed read never
    // sends a finished member to onboarding.
    if (route !== "stay" && route !== "onboarding") return;
    // replace: Back from her destination must not land on /login again, which
    // would only bounce her forward.
    navigate({ href: postLoginDestination(viewer.destination, returnTo), replace: true });
  }, [loading, userId, route, viewer.destination, returnTo, navigate]);

  // Signed in, but her profile could not be read: the page shows the calm
  // try-again state instead of the form.
  return { unavailable: !!userId && route === "unavailable", retry: viewer.retry };
}
