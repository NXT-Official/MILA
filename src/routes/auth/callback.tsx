import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedViewerState, loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { rejectWrongTreeLogin, WRONG_TREE_NOTICE } from "@/lib/staff-route";
import { AtelierSplash } from "@/components/layout/atelier-splash";

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
    // OAuth only exists on the member login, so any staff member arriving here
    // signed in through the main site — undo it and send them to the staff form.
    if (viewer.canAccessStaffArea) {
      await rejectWrongTreeLogin(context.queryClient, WRONG_TREE_NOTICE.member);
      throw redirect({ to: "/staff", replace: true });
    }
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
  const queryClient = useQueryClient();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate({ href: next, replace: true });
      return;
    }
    if (viewer.isLoading) return;
    if (viewer.canAccessStaffArea) {
      void rejectWrongTreeLogin(queryClient, WRONG_TREE_NOTICE.member).then(() =>
        navigate({ to: "/staff", replace: true }),
      );
      return;
    }
    const destination = viewer.destination === "/dashboard" ? next : viewer.destination;
    navigate({ href: destination, replace: true });
  }, [
    loading,
    session,
    viewer.isLoading,
    viewer.canAccessStaffArea,
    viewer.destination,
    next,
    navigate,
    queryClient,
  ]);

  return <AtelierSplash />;
}
