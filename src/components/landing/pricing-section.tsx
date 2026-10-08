import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import { Section, SectionHeading } from "@/components/landing/section";
import { PricingCard } from "@/components/pricing/pricing-card";
import { FreePlanCard } from "@/components/pricing/free-plan-card";
import { planStanding } from "@/components/pricing/plan-value";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorPanel } from "@/components/ui/error-state";
import { choosePlanPath } from "@/components/landing/choose-plan-path";
import { useAuth } from "@/hooks/use-auth";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import type { PricingContent } from "@/lib/landing-content";
import { publicSubscriptionPlansQueryOptions } from "@/lib/queries/subscription-plans";
import { cn } from "@/lib/utils";

/**
 * The Studio edits only the heading and body. Plan names, prices, credits and
 * the choose-plan action come from Supabase (`subscription_plans`), never
 * from Sanity, so editorial content can't misstate what a member pays.
 *
 * So a visitor can judge the plans: a Free column (read from the code) leads,
 * a credit is defined as a look, yearly plans show their monthly cost, and a
 * badge claims only what the numbers support (`planStanding`).
 */
export function PricingSection({
  content = LANDING_FALLBACK.pricing,
}: {
  content?: PricingContent;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  // The Supabase client already retries a failed request with backoff (~7s).
  // react-query's default three retries on top kept the placeholders up for
  // ~35s before the retry panel appeared, so this section adds none of its own.
  const { data, isLoading, isError, refetch } = useQuery({
    ...publicSubscriptionPlansQueryOptions(),
    retry: false,
  });

  // Never return null here: /membership renders this section as its only
  // content, and a failed or empty plans query used to leave a blank page
  // with no message and no retry (Morpessa MW-12). Keeping the heading also
  // preserves the heading order on that page (h1 → h2 → h3 CTA).
  return (
    <Section id="pricing">
      <SectionHeading heading={content.heading} body={content.body} />
      {isLoading ? (
        <div role="status" className="mt-14 sm:mt-16">
          <p className="text-sm text-muted-foreground">Loading plans</p>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="atelier-card h-100" />
            ))}
          </div>
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
        <>
          <p className="mt-10 text-sm font-semibold text-ink">
            1 credit = 1 look. Daily credits reset each day.
          </p>
          <ul
            className={cn(
              "mt-8 grid gap-6 sm:grid-cols-2",
              // The Free column is one more than the plans. Four columns only
              // fit from xl; below that they sit two by two.
              data.length >= 3
                ? "xl:grid-cols-4"
                : data.length === 2
                  ? "md:grid-cols-3"
                  : "max-w-2xl",
            )}
          >
            <FreePlanCard currency={data[0].currency} />
            {data.map((plan) => (
              <PricingCard
                key={plan.id}
                plan={plan}
                standing={planStanding(plan, data)}
                onChoosePlan={() => navigate({ to: choosePlanPath(!!user) })}
              />
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
