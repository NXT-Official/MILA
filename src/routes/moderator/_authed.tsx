import { createFileRoute, redirect } from "@tanstack/react-router";
import { StaffShell } from "@/components/staff/staff-shell";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { supabase } from "@/integrations/supabase/client";
import { SuspendedGate } from "@/components/layout/suspended-gate";

export const Route = createFileRoute("/moderator/_authed")({
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    // Signed out inside a staff tree goes back to the staff login, not /login.
    if (!userId) throw redirect({ to: "/staff", replace: true });
    const viewer = await loadAuthenticatedViewerState(context.queryClient, userId);
    // Open to both staff roles — admins hold moderation/support permissions too,
    // so this tree owns the only copy of those screens.
    if (!viewer.canAccessStaffArea) {
      throw redirect({ to: viewer.destination, replace: true });
    }
  },
  component: ModeratorLayout,
});

function ModeratorLayout() {
  return (
    <SuspendedGate>
      <StaffShell />
    </SuspendedGate>
  );
}
