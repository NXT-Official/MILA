import { createFileRoute } from "@tanstack/react-router";
import { loadLandingContentForRoute } from "@/lib/landing-content.route-loader";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({ meta: [{ title: "How it Works — Mila" }] }),
  loader: () => loadLandingContentForRoute(),
  staleTime: 5 * 60 * 1000,
  component: HowItWorksPage,
});

function HowItWorksPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage title="How it Works" content={content}>
      {/* `howItWorks.hidden` is a home-page control; it does not hide this dedicated page. */}
      <HowItWorksSection content={content.howItWorks} />
    </MarketingSubpage>
  );
}
