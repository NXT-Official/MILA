import { createFileRoute } from "@tanstack/react-router";
import { getLandingContent } from "@/lib/landing-content.functions";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { PricingSection } from "@/components/landing/pricing-section";

export const Route = createFileRoute("/membership")({
  head: () => ({ meta: [{ title: "Membership — Mila" }] }),
  loader: () => getLandingContent(),
  staleTime: 5 * 60 * 1000,
  component: MembershipPage,
});

function MembershipPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage title="Membership" footer={content.footer}>
      <PricingSection />
    </MarketingSubpage>
  );
}
