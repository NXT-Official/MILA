import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { CommunitySection } from "@/components/landing/community-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";
import type { LandingContent } from "@/lib/landing-content";

/**
 * The community page for a given `content`. Kept apart from the route
 * (`/community`) so the visibility flags can be tested without a loader.
 */
export function CommunityPageView({ content }: { content: LandingContent }) {
  return (
    <MarketingSubpage title="Community" content={content}>
      {/* `community.hidden` is a home-page control; it does not hide this dedicated page. */}
      <CommunitySection content={content.community}>
        {!content.community.hideTestimonials && (
          <TestimonialsSection testimonials={content.testimonials} />
        )}
      </CommunitySection>
    </MarketingSubpage>
  );
}
