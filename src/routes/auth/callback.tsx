import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState, loadAuthenticatedViewerState } from "@/lib/queries/auth";

function sanitizeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/|\\)/.test(next) ? next : "/dashboard";
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
    const destination = viewer.destination === "/dashboard" ? search.next : viewer.destination;
    throw redirect({ href: destination, replace: true });
  },
  component: AuthCallback,
});

function AuthCallback() {
  const { next } = Route.useSearch();
  const { session, loading } = useAuth();
  const viewer = useAuthenticatedViewerState(session?.user.id);
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate({ href: next, replace: true });
      return;
    }
    if (viewer.isLoading) return;
    const destination = viewer.destination === "/dashboard" ? next : viewer.destination;
    navigate({ href: destination, replace: true });
  }, [loading, session, viewer.isLoading, viewer.destination, next, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="font-serif text-2xl tracking-[0.2em] text-muted-foreground animate-pulse">
        ATELIER
      </div>
    </div>
  );
}
