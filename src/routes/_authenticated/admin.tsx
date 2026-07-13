import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/admin-shell";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  // Fast path for client-side navigations only — see AdminShell for the
  // component-level check that actually enforces this once hydrated.
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    const viewer = await loadAuthenticatedViewerState(context.queryClient, userId);
    if (!viewer.canAccessStaffArea) {
      throw redirect({ to: viewer.destination, replace: true });
    }
  },
  component: AdminShell,
});
