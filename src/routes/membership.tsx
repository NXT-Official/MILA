import { createFileRoute } from "@tanstack/react-router";
import { loadLandingContentForRoute } from "@/lib/landing-content.route-loader";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { PricingSection } from "@/components/landing/pricing-section";

export const Route = createFileRoute("/membership")({
  head: () => ({ meta: [{ title: "Membership — Mila" }] }),
  loader: () => loadLandingContentForRoute(),
  staleTime: 5 * 60 * 1000,
  component: MembershipPage,
});

function MembershipPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage title="Membership" content={content}>
      {/* `pricing.hidden` is a home-page control; it does not hide this dedicated page. */}
      <PricingSection content={content.pricing} />
    </MarketingSubpage>
  );
}
