import { createFileRoute } from "@tanstack/react-router";
import { loadLandingContentForRoute } from "@/lib/landing-content.route-loader";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { DupeHunterSection } from "@/components/landing/dupe-hunter-section";

export const Route = createFileRoute("/dupe-hunter")({
  head: () => ({ meta: [{ title: "Dupe Hunter — Mila" }] }),
  loader: () => loadLandingContentForRoute(),
  staleTime: 5 * 60 * 1000,
  component: DupeHunterPage,
});

function DupeHunterPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage title="Dupe Hunter" content={content}>
      {/* `dupeHunter.hidden` is a home-page control; it does not hide this dedicated page. */}
      <DupeHunterSection content={content.dupeHunter} />
    </MarketingSubpage>
  );
}
