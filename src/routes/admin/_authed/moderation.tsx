import { createFileRoute } from "@tanstack/react-router";
import { ModerationPage } from "@/components/staff/moderation-page";
import { requireStaffRoutePermission } from "@/lib/staff-route";

export const Route = createFileRoute("/admin/_authed/moderation")({
  beforeLoad: ({ context }) => requireStaffRoutePermission(context.queryClient, "moderation.view"),
  component: ModerationPage,
});
