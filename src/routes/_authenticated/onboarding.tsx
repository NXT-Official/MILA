import { createFileRoute, Outlet, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { routeForViewer, useAuthenticatedViewerState } from "@/lib/queries/auth";
import { AuthReconnecting } from "@/components/layout/auth-reconnecting";
import { useSignOut } from "@/hooks/use-sign-out";
import { IconButton } from "@/components/ui/icon-button";
import { sanitizeRestartFlag } from "@/constants/steps";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingLayout,
});

function OnboardingLayout() {
  const { user } = useAuth();
  const viewer = useAuthenticatedViewerState(user?.id);
  const navigate = useNavigate();
  const { signingOut, handleSignOut } = useSignOut();
  const search = useSearch({ strict: false }) as { restart?: unknown };
  const isRestart = sanitizeRestartFlag(search.restart);
  // Captured once so finishing the wizard (which makes the profile complete)
  // never bounces the user mid-flow. A complete profile only belongs here
  // when the user explicitly chose Restart Style Analysis.
  const wasCompleteAtLoad = useRef<boolean | null>(null);
  const redirectAtLoad = useRef<boolean | null>(null);
  // Captured only from a profile that was actually read: a failed read is not
  // "incomplete" and must not decide anything.
  const route = routeForViewer(viewer);
  if (redirectAtLoad.current === null && user && (route === "stay" || route === "onboarding")) {
    wasCompleteAtLoad.current = viewer.isStyleProfileComplete;
    redirectAtLoad.current = viewer.isStyleProfileComplete && !isRestart;
  }
  const shouldRedirectForComplete = redirectAtLoad.current === true;

  useEffect(() => {
    if (!user || redirectAtLoad.current === null) return;
    if (shouldRedirectForComplete) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [user, shouldRedirectForComplete, navigate]);

  // Her profile could not be read yet: the calm try-again state, not the wizard.
  if (user && redirectAtLoad.current === null && route === "unavailable") {
    return <AuthReconnecting onRetry={viewer.retry} signInSearch={{}} />;
  }

  if (!user || redirectAtLoad.current === null || shouldRedirectForComplete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-stone">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <header className="atelier-container flex items-center justify-between py-6">
        <Link
          to={wasCompleteAtLoad.current ? "/dashboard" : "/onboarding/style-profile"}
          className="font-display text-xl tracking-label text-ink"
        >
          MILA
        </Link>
        <IconButton variant="ghost" label="Sign out" onClick={handleSignOut} disabled={signingOut}>
          <LogOut className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      </header>
      <main className="atelier-container flex-1 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
