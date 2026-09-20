import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Section, SectionHeading } from "@/components/landing/section";
import { PricingCard } from "@/components/pricing/pricing-card";
import { Skeleton } from "@/components/ui/skeleton";
import { publicSubscriptionPlansQueryOptions } from "@/lib/queries/subscription-plans";

export function PricingSection() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery(publicSubscriptionPlansQueryOptions());

  if (!isLoading && !data?.length) return null;

  return (
    <Section id="pricing">
      <SectionHeading
        align="center"
        kicker="Membership"
        heading="Choose your Atelier access."
        body="Every plan includes daily styling credits, credit packs to top up any day, and a verified badge on your profile."
      />
      {isLoading ? (
        <div className="mt-14 grid gap-6 sm:mt-16 sm:grid-cols-2 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="atelier-card h-100" />
          ))}
        </div>
      ) : (
        <ul className="mt-14 grid gap-6 sm:mt-16 sm:grid-cols-2 md:grid-cols-3">
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
