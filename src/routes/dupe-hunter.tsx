import { createFileRoute } from "@tanstack/react-router";
import { getLandingContent } from "@/lib/landing-content.functions";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { DupeHunterSection } from "@/components/landing/dupe-hunter-section";

export const Route = createFileRoute("/dupe-hunter")({
  head: () => ({ meta: [{ title: "Dupe Hunter — Mila" }] }),
  loader: () => getLandingContent(),
  staleTime: 5 * 60 * 1000,
  component: DupeHunterPage,
});

function DupeHunterPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage title="Dupe Hunter" footer={content.footer}>
      <DupeHunterSection content={content.dupeHunter} />
    </MarketingSubpage>
  );
}
