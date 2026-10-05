import { createFileRoute } from "@tanstack/react-router";
import { loadLandingContentForRoute } from "@/lib/landing-content.route-loader";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { DossierSection } from "@/components/landing/dossier-section";

export const Route = createFileRoute("/style-dossier")({
  head: () => ({ meta: [{ title: "The Style Dossier — Mila" }] }),
  loader: () => loadLandingContentForRoute(),
  staleTime: 5 * 60 * 1000,
  component: StyleDossierPage,
});

function StyleDossierPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage title="The Style Dossier" content={content}>
      {/* `dossier.hidden` is a home-page control; it does not hide this dedicated page. */}
      <DossierSection content={content.dossier} />
    </MarketingSubpage>
  );
}
