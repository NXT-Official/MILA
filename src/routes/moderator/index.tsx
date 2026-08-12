import { createFileRoute } from "@tanstack/react-router";
import { StaffLoginPage } from "@/components/staff/staff-login-page";

// /moderator is the moderator entry point — see /admin for the same shape.
export const Route = createFileRoute("/moderator/")({
  component: () => <StaffLoginPage tree="moderator" />,
});
