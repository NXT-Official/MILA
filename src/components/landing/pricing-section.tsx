import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import { Section, SectionHeading } from "@/components/landing/section";
import { PricingCard } from "@/components/pricing/pricing-card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorPanel } from "@/components/ui/error-state";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import type { PricingContent } from "@/lib/landing-content";
import { publicSubscriptionPlansQueryOptions } from "@/lib/queries/subscription-plans";
import { cn } from "@/lib/utils";

/**
 * The Studio edits only the heading and body. Plan names, prices, credits and
 * the choose-plan action come from Supabase (`subscription_plans`), never
 * from Sanity, so editorial content can't misstate what a member pays.
 */
export function PricingSection({
  content = LANDING_FALLBACK.pricing,
}: {
  content?: PricingContent;
}) {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery(publicSubscriptionPlansQueryOptions());

  // Never return null here: /membership renders this section as its only
  // content, and a failed or empty plans query used to leave a blank page
  // with no message and no retry (Morpessa MW-12). Keeping the heading also
  // preserves the heading order on that page (h1 → h2 → h3 CTA).
  return (
    <Section id="pricing">
      <SectionHeading align="center" heading={content.heading} body={content.body} />
      {isLoading ? (
        <div className="mt-14 grid gap-6 sm:mt-16 sm:grid-cols-2 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="atelier-card h-100" />
          ))}
        </div>
      ) : isError ? (
        <LoadErrorPanel title="Couldn't load membership plans" onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState
          role="status"
          className="mx-auto mt-14 max-w-xl"
          icon={<ScrollText className="size-8" strokeWidth={1.25} />}
          title="Membership plans are being prepared."
          description="Please check back soon."
        />
      ) : (
        <ul
          className={cn(
            "mt-14 grid gap-6 sm:mt-16 sm:grid-cols-2",
            data!.length >= 3 ? "md:grid-cols-3" : "mx-auto max-w-2xl",
          )}
        >
          {data!.map((plan) => (
            <PricingCard
              key={plan.id}
              plan={plan}
              onChoosePlan={() => navigate({ to: "/login" })}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}
