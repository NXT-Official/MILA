import { createFileRoute } from "@tanstack/react-router";
import { SupportPage } from "@/components/staff/support-page";
import { requireStaffRoutePermission } from "@/lib/staff-route";

export const Route = createFileRoute("/moderator/_authed/support")({
  beforeLoad: ({ context }) => requireStaffRoutePermission(context.queryClient, "support.view"),
  component: SupportPage,
});
