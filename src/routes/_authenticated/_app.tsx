import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState, loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { supabase } from "@/integrations/supabase/client";
import { AtelierSplash } from "@/components/layout/atelier-splash";

export const Route = createFileRoute("/_authenticated/_app")({
  beforeLoad: async ({ context, location }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    const viewer = await loadAuthenticatedViewerState(context.queryClient, userId);
    const isProfileRoute = location.pathname.startsWith("/profile/");
    if (viewer.canAccessStaffArea && !isProfileRoute) {
      throw redirect({ to: viewer.destination, replace: true });
    }
    if (!viewer.isStyleProfileComplete && !isProfileRoute) {
      throw redirect({ to: "/onboarding/style-profile", replace: true });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const viewer = useAuthenticatedViewerState(user?.id);
  const isProfileRoute = path.startsWith("/profile/");

  useEffect(() => {
    if (!user || viewer.isLoading) return;
    if (viewer.canAccessStaffArea && !isProfileRoute) {
      navigate({ to: viewer.destination, replace: true });
      return;
    }
    if (!viewer.isStyleProfileComplete && !isProfileRoute) {
      navigate({ to: "/onboarding/style-profile", replace: true });
    }
  }, [
    user,
    viewer.isLoading,
    viewer.canAccessStaffArea,
    viewer.destination,
    viewer.isStyleProfileComplete,
    isProfileRoute,
    navigate,
  ]);

  if (
    !user ||
    viewer.isLoading ||
    (viewer.canAccessStaffArea && !isProfileRoute) ||
    (!viewer.isStyleProfileComplete && !isProfileRoute)
  ) {
    return <AtelierSplash />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
