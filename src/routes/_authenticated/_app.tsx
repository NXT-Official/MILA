import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import {
  routeForViewer,
  useAuthenticatedViewerState,
  loadAuthenticatedViewerState,
} from "@/lib/queries/auth";
import { supabase } from "@/integrations/supabase/client";
import { readSession } from "@/lib/auth-session";
import { loginRedirectSearch } from "@/lib/safe-redirect";
import { AtelierSplash } from "@/components/layout/atelier-splash";
import { AuthReconnecting } from "@/components/layout/auth-reconnecting";

export const Route = createFileRoute("/_authenticated/_app")({
  beforeLoad: async ({ context, location }) => {
    if (typeof window === "undefined") return;
    // Signed out or unreachable: the parent `/_authenticated` guard and layout
    // decide (redirect or reconnect). This gate never redirects for either.
    const read = await readSession(supabase.auth);
    if (read.kind !== "session") return;
    const userId = read.session.user.id;
    const viewer = await loadAuthenticatedViewerState(context.queryClient, userId);
    const isProfileRoute = location.pathname.startsWith("/profile/");
    // Only a profile that was read and is incomplete goes to onboarding. A
    // failed read keeps her here; the layout shows the try-again state.
    if (routeForViewer(viewer) === "onboarding" && !isProfileRoute) {
      throw redirect({ to: "/onboarding/style-profile", replace: true });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const { user } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const viewer = useAuthenticatedViewerState(userId);
  const route = routeForViewer(viewer);
  const isProfileRoute = path.startsWith("/profile/");
  const href = useLocation({ select: (location) => location.href });

  useEffect(() => {
    if (!userId) return;
    if (route === "onboarding" && !isProfileRoute) {
      navigate({ to: "/onboarding/style-profile", replace: true });
    }
  }, [userId, route, isProfileRoute, navigate]);

  // Her profile could not be read (network, server, session reconnecting):
  // keep her here with the calm try-again state, never onboarding.
  if (user && route === "unavailable" && !isProfileRoute) {
    return <AuthReconnecting onRetry={viewer.retry} signInSearch={loginRedirectSearch(href)} />;
  }

  if (!user || route === "wait" || (route === "onboarding" && !isProfileRoute)) {
    return <AtelierSplash />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
