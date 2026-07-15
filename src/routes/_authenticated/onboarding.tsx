import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState } from "@/lib/queries/auth";
import { useSignOut } from "@/hooks/use-sign-out";
import { IconButton } from "@/components/ui/icon-button";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingLayout,
});

function OnboardingLayout() {
  const { user } = useAuth();
  const viewer = useAuthenticatedViewerState(user?.id);
  const navigate = useNavigate();
  const { signingOut, handleSignOut } = useSignOut();
  const wasCompleteAtLoad = useRef<boolean | null>(null);
  if (wasCompleteAtLoad.current === null && user && !viewer.isLoading) {
    wasCompleteAtLoad.current = viewer.isStyleProfileComplete;
  }
  const shouldRedirectForComplete = wasCompleteAtLoad.current === true;

  useEffect(() => {
    if (!user || viewer.isLoading) return;
    if (viewer.canAccessStaffArea) {
      navigate({ to: "/admin", replace: true });
      return;
    }
    if (shouldRedirectForComplete) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [user, viewer.isLoading, viewer.canAccessStaffArea, shouldRedirectForComplete, navigate]);

  if (!user || viewer.isLoading || viewer.canAccessStaffArea || shouldRedirectForComplete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-stone">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="mila-page flex min-h-screen flex-col">
      <header className="mila-container flex items-center justify-between py-6">
        <Link
          to="/onboarding/style-profile"
          className="font-display text-xl tracking-[0.2em] text-ink"
        >
          MILA
        </Link>
        <IconButton variant="ghost" label="Sign out" onClick={handleSignOut} disabled={signingOut}>
          <LogOut className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      </header>
      <main className="mila-container flex-1 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
