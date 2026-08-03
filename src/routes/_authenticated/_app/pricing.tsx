import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorPanel } from "@/components/ui/error-state";
import { PricingCard } from "@/components/pricing/pricing-card";
import { publicSubscriptionPlansQueryOptions } from "@/lib/queries/subscription-plans";
import { useAuth } from "@/hooks/use-auth";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";

export const Route = createFileRoute("/_authenticated/_app/pricing")({
  component: PricingPage,
});

function PricingPage() {
  const { data, isLoading, isError, refetch } = useQuery(publicSubscriptionPlansQueryOptions());
  const { user } = useAuth();
  const { openCheckout, ready } = usePaddleCheckout(user?.id);

  return (
    <div className="atelier-page max-w-6xl">
      <PageHeader
        align="center"
        kicker="Membership"
        title="Choose Your Atelier Access"
        description="Select the membership that best fits the way you want to style, explore, and create with Mila."
      />

      {isLoading ? (
        <PricingSkeleton />
      ) : isError ? (
        <LoadErrorPanel title="Couldn't load membership plans" onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState
          role="status"
          className="mx-auto max-w-xl"
          icon={<ScrollText className="size-8" strokeWidth={1.25} />}
          title="Membership plans are being prepared."
          description="Please check back soon."
        />
      ) : (
        <ul className="mx-auto grid max-w-5xl grid-cols-1 gap-6 pt-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {data.map((plan) => (
            <PricingCard
              key={plan.id}
              plan={plan}
              disabled={!ready}
              onChoosePlan={
                user ? () => openCheckout(plan, { id: user.id, email: user.email }) : undefined
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PricingSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading membership plans"
      className="mx-auto grid max-w-5xl grid-cols-1 gap-6 pt-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8"
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="atelier-card h-100" />
      ))}
    </div>
  );
}
