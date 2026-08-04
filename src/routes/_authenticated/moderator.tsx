import { createFileRoute, redirect } from "@tanstack/react-router";
import { StaffShell } from "@/components/staff/staff-shell";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/moderator")({
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    const viewer = await loadAuthenticatedViewerState(context.queryClient, userId);
    // Open to both staff roles — admins hold moderation/support permissions too,
    // so this tree owns the only copy of those screens.
    if (!viewer.canAccessStaffArea) {
      throw redirect({ to: viewer.destination, replace: true });
    }
  },
  component: StaffShell,
});
