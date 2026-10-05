import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import type { LandingContent } from "@/lib/landing-content";

/**
 * The how-it-works page for a given `content`. Kept apart from the route
 * (`/how-it-works`) so the visibility flags can be tested without a loader.
 */
export function HowItWorksPageView({ content }: { content: LandingContent }) {
  return (
    <MarketingSubpage title="How it Works" content={content}>
      {/* `howItWorks.hidden` is a home-page control; it does not hide this dedicated page. */}
      <HowItWorksSection content={content.howItWorks} />
    </MarketingSubpage>
  );
}
