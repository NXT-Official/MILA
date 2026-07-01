import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/index")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});