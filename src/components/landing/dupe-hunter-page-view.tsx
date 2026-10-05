import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { DupeHunterSection } from "@/components/landing/dupe-hunter-section";
import type { LandingContent } from "@/lib/landing-content";

/**
 * The dupe hunter page for a given `content`. Kept apart from the route
 * (`/dupe-hunter`) so the visibility flags can be tested without a loader.
 */
export function DupeHunterPageView({ content }: { content: LandingContent }) {
  return (
    <MarketingSubpage title="Dupe Hunter" content={content}>
      {/* `dupeHunter.hidden` is a home-page control; it does not hide this dedicated page. */}
      <DupeHunterSection content={content.dupeHunter} />
    </MarketingSubpage>
  );
}
