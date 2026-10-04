import { createFileRoute } from "@tanstack/react-router";
import { getLandingContent } from "@/lib/landing-content.functions";
import { MarketingSubpage } from "@/components/landing/marketing-subpage";
import { CommunitySection } from "@/components/landing/community-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";

export const Route = createFileRoute("/community")({
  head: () => ({ meta: [{ title: "Community — Mila" }] }),
  loader: () => getLandingContent(),
  staleTime: 5 * 60 * 1000,
  component: CommunityPage,
});

function CommunityPage() {
  const content = Route.useLoaderData();
  return (
    <MarketingSubpage title="Community" content={content}>
      <CommunitySection content={content.community}>
        <TestimonialsSection testimonials={content.testimonials} />
      </CommunitySection>
    </MarketingSubpage>
  );
}
