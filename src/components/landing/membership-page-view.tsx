import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { PricingSection } from "@/components/landing/pricing-section";
import type { LandingContent } from "@/lib/landing-content";

/**
 * The membership page for a given `content`. Kept apart from the route
 * (`/membership`) so the visibility flags can be tested without a loader.
 */
export function MembershipPageView({ content }: { content: LandingContent }) {
  return (
    <MarketingSubpage title="Membership" content={content}>
      {/* `pricing.hidden` is a home-page control; it does not hide this dedicated page. */}
      <PricingSection content={content.pricing} />
    </MarketingSubpage>
  );
}
