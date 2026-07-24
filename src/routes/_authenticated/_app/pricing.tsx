import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PricingCard } from "@/components/pricing/pricing-card";
import { publicSubscriptionPlansQueryOptions } from "@/lib/queries/subscription-plans";
import { useAuth } from "@/hooks/use-auth";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";

export const Route = createFileRoute("/_authenticated/_app/pricing")({
  component: PricingPage,
});

function PricingPage() {
  const { data, isLoading, isError, refetch } = useQuery(publicSubscriptionPlansQueryOptions());
  const { user } = useAuth();
  const { openCheckout, ready } = usePaddleCheckout(user?.id);

  return (
    <div className="atelier-page max-w-6xl">
      <header className="mb-10 text-center sm:mb-14">
        <p className="atelier-kicker mb-3">Membership</p>
        <h1 className="atelier-title">Choose Your Atelier Access</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted">
          Select the membership that best fits the way you want to style, explore, and create with
          Mila.
        </p>
      </header>

      {isLoading ? (
        <PricingSkeleton />
      ) : isError ? (
        <div role="alert" className="atelier-card mx-auto max-w-xl p-10 text-center sm:p-14">
          <p className="mb-2 font-serif text-2xl text-ink">Couldn't load membership plans</p>
          <p className="text-sm text-muted">
            Something went wrong on our side. Please try again in a moment.
          </p>
          <Button variant="secondary" className="mt-6" onClick={() => refetch()}>
            Try Again
          </Button>
        </div>
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
        <div key={i} className="atelier-card h-100 animate-pulse bg-foreground/6" />
      ))}
    </div>
  );
}
