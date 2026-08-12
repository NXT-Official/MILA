import { createFileRoute } from "@tanstack/react-router";
import { StaffLoginPage } from "@/components/staff/staff-login-page";

// /admin is the steward entry point: the sign-in form when signed out, and
// useLoginRedirect forwards an already-signed-in steward to /admin/dashboard.
export const Route = createFileRoute("/admin/")({
  component: () => <StaffLoginPage tree="admin" />,
});
