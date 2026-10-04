import { createFileRoute } from "@tanstack/react-router";
import { getLandingContent } from "@/lib/landing-content.functions";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({ meta: [{ title: "How it Works — Mila" }] }),
  loader: () => getLandingContent(),
  staleTime: 5 * 60 * 1000,
  component: HowItWorksPage,
});

function HowItWorksPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage title="How it Works" content={content}>
      <HowItWorksSection content={content.howItWorks} />
    </MarketingSubpage>
  );
}
