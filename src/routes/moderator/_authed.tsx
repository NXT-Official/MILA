import { createFileRoute, redirect } from "@tanstack/react-router";
import { StaffShell } from "@/components/staff/staff-shell";
import { loadAuthenticatedViewerState } from "@/lib/queries/auth";
import { supabase } from "@/integrations/supabase/client";
import { SuspendedGate } from "@/components/layout/suspended-gate";

export const Route = createFileRoute("/moderator/_authed")({
  // Client-only guard — see /admin/_authed for why.
  ssr: false,
  beforeLoad: async ({ context }) => {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) throw redirect({ to: "/", replace: true });
    const viewer = await loadAuthenticatedViewerState(context.queryClient, userId);
    // Exact role, not permission: an admin holds every moderator permission, so
    // a permission check would let stewards in. They have their own copies of
    // these screens under /admin, so this costs them nothing.
    if (!viewer.isModerator) {
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
