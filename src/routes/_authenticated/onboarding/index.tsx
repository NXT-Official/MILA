import { createFileRoute, redirect } from "@tanstack/react-router";

// The layout has no content of its own, so a bare /onboarding would render an
// empty shell.
export const Route = createFileRoute("/_authenticated/onboarding/")({
  beforeLoad: () => {
    throw redirect({ to: "/onboarding/style-profile", replace: true });
  },
});
