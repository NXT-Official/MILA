import { createFileRoute, redirect } from "@tanstack/react-router";
import { StaffShell } from "@/components/staff/staff-shell";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { hasPermission } from "@/lib/authorization";
import { supabase } from "@/integrations/supabase/client";
import { SuspendedGate } from "@/components/layout/suspended-gate";

export const Route = createFileRoute("/admin/_authed")({
  beforeLoad: async ({ context }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    // Signed out inside a staff tree goes back to the staff login, not /login.
    if (!userId) throw redirect({ to: "/staff", replace: true });
    const viewer = await loadAuthenticatedViewerState(context.queryClient, userId);
    // Admin-only: a moderator has admin.access but no business in this tree,
    // and their destination sends them to /moderator instead.
    if (!hasPermission(viewer.roles, "admin.dashboard.view")) {
      throw redirect({ to: viewer.destination, replace: true });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <SuspendedGate>
      <StaffShell />
    </SuspendedGate>
  );
}
