import { createFileRoute, redirect } from "@tanstack/react-router";
import { MODERATOR_HOME } from "@/lib/authorization";

export const Route = createFileRoute("/_authenticated/moderator/")({
  beforeLoad: () => {
    throw redirect({ to: MODERATOR_HOME, replace: true });
  },
});
