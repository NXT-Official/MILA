import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Section, SectionHeading } from "@/components/landing/section";
import { PricingCard } from "@/components/pricing/pricing-card";
import { Skeleton } from "@/components/ui/skeleton";
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
  const { data, isLoading, isError } = useQuery(publicSubscriptionPlansQueryOptions());

  if (!isLoading && (isError || !data?.length)) return null;

  return (
    <Section id="pricing">
      <SectionHeading align="center" heading={content.heading} body={content.body} />
      {isLoading ? (
        <div className="mt-14 grid gap-6 sm:mt-16 sm:grid-cols-2 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="atelier-card h-100" />
          ))}
        </div>
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
