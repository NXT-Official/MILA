import { createFileRoute } from "@tanstack/react-router";
import {
  loadLandingContentForRoute,
  shouldReloadLandingRoute,
  useRememberServerRendered,
} from "@/lib/landing-content.route-loader";
import { StyleDossierPageView } from "@/components/landing/style-dossier-page-view";

export const Route = createFileRoute("/style-dossier")({
  head: () => ({ meta: [{ title: "The Style Dossier — Mila" }] }),
  loader: loadLandingContentForRoute,
  shouldReload: shouldReloadLandingRoute,
  staleTime: 5 * 60 * 1000,
  component: StyleDossierPage,
});

function StyleDossierPage() {
  const content = Route.useLoaderData();
  useRememberServerRendered(content);
  return <StyleDossierPageView content={content} />;
}
