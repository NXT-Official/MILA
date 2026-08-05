import { createFileRoute, redirect } from "@tanstack/react-router";
import { MODERATOR_HOME } from "@/lib/authorization";

export const Route = createFileRoute("/moderator/")({
  beforeLoad: () => {
    throw redirect({ to: MODERATOR_HOME, replace: true });
  },
});
