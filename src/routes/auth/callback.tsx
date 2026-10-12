import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  routeForViewer,
  useAuthenticatedViewerState,
  loadAuthenticatedViewerState,
} from "@/lib/queries/auth";
import { safeRedirect } from "@/lib/safe-redirect";
import { AtelierSplash } from "@/components/layout/atelier-splash";
import { AuthReconnecting } from "@/components/layout/auth-reconnecting";

// The same same-origin rules as /login's `redirect` (dot segments, encoded
// separators and control characters, backslashes all refused).
function sanitizeNext(next: unknown): string {
  return safeRedirect(next) ?? "/dashboard";
}

export const Route = createFileRoute("/auth/callback")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: sanitizeNext(search.next),
  }),
  beforeLoad: async ({ search, context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ href: search.next });
    }
    const viewer = await loadAuthenticatedViewerState(context.queryClient, data.session.user.id);
    // A failed profile read decides nothing: the page shows the try-again state.
    if (viewer.status !== "ready") return;
    const destination = viewer.destination === "/dashboard" ? search.next : viewer.destination;
    throw redirect({ href: destination, replace: true });
  },
  component: AuthCallback,
});

function AuthCallback() {
  const { next } = Route.useSearch();
  const { session, loading } = useAuth();
  const viewer = useAuthenticatedViewerState(session?.user.id);
  const route = routeForViewer(viewer);
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate({ href: next, replace: true });
      return;
    }
    // Only a profile that was actually read decides where she goes.
    if (route !== "stay" && route !== "onboarding") return;
    const destination = viewer.destination === "/dashboard" ? next : viewer.destination;
    navigate({ href: destination, replace: true });
  }, [loading, session, route, viewer.destination, next, navigate]);

  if (session && route === "unavailable") {
    return <AuthReconnecting onRetry={viewer.retry} signInSearch={{ redirect: next }} />;
  }

  return <AtelierSplash />;
}
