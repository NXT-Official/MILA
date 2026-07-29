import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Lock, ScrollText, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorPanel } from "@/components/ui/error-state";
import { PricingCard } from "@/components/pricing/pricing-card";
import { publicSubscriptionPlansQueryOptions } from "@/lib/queries/subscription-plans";
import { publicCreditPacksQueryOptions } from "@/lib/queries/credit-packs";
import { mySubscriptionQueryOptions } from "@/lib/queries/subscriptions";
import { useAuth } from "@/hooks/use-auth";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/_app/pricing")({
  component: PricingPage,
});

function PricingPage() {
  const { data, isLoading, isError, refetch } = useQuery(publicSubscriptionPlansQueryOptions());
  const { user } = useAuth();
  const { openCheckout, ready } = usePaddleCheckout(user?.id);
  const { data: packs } = useQuery(publicCreditPacksQueryOptions());
  const { data: subscription } = useQuery({
    ...mySubscriptionQueryOptions(user?.id),
    enabled: !!user,
  });
  const subscribed = !!subscription;

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

      {!!packs?.length && (
        <section className="atelier-card mx-auto mt-16 max-w-3xl p-8 text-center sm:mt-20 sm:p-10">
          <p className="atelier-kicker mb-3">Credit packs</p>
          <h2 className="font-serif text-2xl text-ink sm:text-3xl">
            {subscribed ? "Out of credits before the day resets?" : "A membership extra"}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
            {subscribed
              ? "Top up with a pack and keep styling with Mila today. Pack credits are used after your daily allowance runs out, and they never expire."
              : "Credit packs top up your balance on days you run through your allowance. They're available to members only — choose a membership above to unlock them."}
          </p>

          <div className="mt-6 flex justify-center">
            {subscribed ? (
              <Button asChild variant="secondary" className="min-w-56">
                <Link to="/credit-packs">
                  <Zap className="size-4" aria-hidden="true" strokeWidth={1.75} />
                  Browse Credit Packs
                </Link>
              </Button>
            ) : (
              // Cosmetic half of the gate; the page itself re-checks on the server.
              <Button type="button" variant="secondary" className="min-w-56" disabled>
                <Lock className="size-4" aria-hidden="true" strokeWidth={1.75} />
                Members only
              </Button>
            )}
          </div>
        </section>
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
