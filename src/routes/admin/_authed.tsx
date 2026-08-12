import { createFileRoute, redirect } from "@tanstack/react-router";
import { StaffShell } from "@/components/staff/staff-shell";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { hasPermission } from "@/lib/authorization";
import { supabase } from "@/integrations/supabase/client";
import { SuspendedGate } from "@/components/layout/suspended-gate";

export const Route = createFileRoute("/admin/_authed")({
  // Session lives in localStorage, so the guard can only run on the client.
  // Without this the server SSRs the match as "success" and beforeLoad never
  // re-runs on hydration — the tree renders signed out.
  ssr: false,
  beforeLoad: async ({ context }) => {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) throw redirect({ to: "/", replace: true });
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
