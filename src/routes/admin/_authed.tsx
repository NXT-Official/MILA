import { createFileRoute, redirect } from "@tanstack/react-router";
import { StaffShell } from "@/components/staff/staff-shell";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { hasPermission } from "@/lib/authorization";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    const viewer = await loadAuthenticatedViewerState(context.queryClient, userId);
    // Admin-only: a moderator has admin.access but no business in this tree,
    // and their destination sends them to /moderator instead.
    if (!hasPermission(viewer.roles, "admin.dashboard.view")) {
      throw redirect({ to: viewer.destination, replace: true });
    }
  },
  component: StaffShell,
});
