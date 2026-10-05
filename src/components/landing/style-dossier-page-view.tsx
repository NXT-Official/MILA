import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { DossierSection } from "@/components/landing/dossier-section";
import type { LandingContent } from "@/lib/landing-content";

/**
 * The style dossier page for a given `content`. Kept apart from the route
 * (`/style-dossier`) so the visibility flags can be tested without a loader.
 */
export function StyleDossierPageView({ content }: { content: LandingContent }) {
  return (
    <MarketingSubpage title="The Style Dossier" content={content}>
      {/* `dossier.hidden` is a home-page control; it does not hide this dedicated page. */}
      <DossierSection content={content.dossier} />
    </MarketingSubpage>
  );
}
