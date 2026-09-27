import { createFileRoute } from "@tanstack/react-router";
import { getLandingContent } from "@/lib/landing-content.functions";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { DossierSection } from "@/components/landing/dossier-section";

export const Route = createFileRoute("/style-dossier")({
  head: () => ({ meta: [{ title: "The Style Dossier — Mila" }] }),
  loader: () => getLandingContent(),
  staleTime: 5 * 60 * 1000,
  component: StyleDossierPage,
});

function StyleDossierPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage title="The Style Dossier" footer={content.footer}>
      <DossierSection content={content.dossier} />
    </MarketingSubpage>
  );
}
