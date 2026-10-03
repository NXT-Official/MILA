import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/studio` is the name the nav uses for this surface (sidebar + mobile tab
 * bar both say "Studio"), so the URL should resolve to the Digital Style
 * Dossier instead of 404ing. The target route's own guard handles signed-out
 * visitors — this only fixes the address.
 */
export const Route = createFileRoute("/studio")({
  beforeLoad: () => {
    throw redirect({ to: "/style-profile" });
  },
});
