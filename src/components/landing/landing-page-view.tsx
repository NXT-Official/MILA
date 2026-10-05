import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { DossierSection } from "@/components/landing/dossier-section";
import { DailyPaletteSection } from "@/components/landing/daily-palette-section";
import { ConciergeSection } from "@/components/landing/concierge-section";
import { DupeHunterSection } from "@/components/landing/dupe-hunter-section";
import { FeedSection } from "@/components/landing/feed-section";
import { CommunitySection } from "@/components/landing/community-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { SiteFooter } from "@/components/landing/site-footer";
import type { LandingContent } from "@/lib/landing-content";

/**
 * The home page for a given `content`. Kept apart from the route (`/`) so the
 * visibility flags can be tested without a loader.
 */
export function LandingPageView({ content }: { content: LandingContent }) {
  // Section order is fixed in code; the Studio can only hide a section.
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="overflow-x-clip">
        <HeroSection content={content.hero} cta={content.cta} />
        {!content.howItWorks.hidden && <HowItWorksSection content={content.howItWorks} />}
        {!content.dossier.hidden && <DossierSection content={content.dossier} />}
        {!content.dailyPalette.hidden && <DailyPaletteSection content={content.dailyPalette} />}
        {!content.concierge.hidden && <ConciergeSection content={content.concierge} />}
        {!content.dupeHunter.hidden && <DupeHunterSection content={content.dupeHunter} />}
        {!content.feed.hidden && <FeedSection content={content.feed} />}
        {!content.community.hidden && (
          <CommunitySection content={content.community}>
            {!content.community.hideTestimonials && (
              <TestimonialsSection testimonials={content.testimonials} />
            )}
          </CommunitySection>
        )}
        {!content.pricing.hidden && <PricingSection content={content.pricing} />}
        {!content.finalCta.hidden && (
          <FinalCtaSection content={content.finalCta} cta={content.cta} />
        )}
      </main>
      <SiteFooter content={content.footer} />
    </div>
  );
}
