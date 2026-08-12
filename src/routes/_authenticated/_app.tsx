import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState, loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { supabase } from "@/integrations/supabase/client";
import { AtelierSplash } from "@/components/layout/atelier-splash";

export const Route = createFileRoute("/_authenticated/_app")({
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    const viewer = await loadAuthenticatedViewerState(context.queryClient, userId);
    if (viewer.canAccessStaffArea) {
      throw redirect({ to: viewer.destination, replace: true });
    }
    if (!viewer.isStyleProfileComplete) {
      throw redirect({ to: "/onboarding/style-profile", replace: true });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const viewer = useAuthenticatedViewerState(user?.id);

  useEffect(() => {
    if (!user || viewer.isLoading) return;
    if (viewer.canAccessStaffArea) {
      navigate({ to: viewer.destination, replace: true });
      return;
    }
    if (!viewer.isStyleProfileComplete) {
      navigate({ to: "/onboarding/style-profile", replace: true });
    }
  }, [
    user,
    viewer.isLoading,
    viewer.canAccessStaffArea,
    viewer.destination,
    viewer.isStyleProfileComplete,
    navigate,
  ]);

  if (!user || viewer.isLoading || viewer.canAccessStaffArea || !viewer.isStyleProfileComplete) {
    return <AtelierSplash />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
