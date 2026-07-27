import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Lock, ScrollText, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PricingCard } from "@/components/pricing/pricing-card";
import { publicSubscriptionPlansQueryOptions } from "@/lib/queries/subscription-plans";
import { publicCreditPacksQueryOptions } from "@/lib/queries/credit-packs";
import { mySubscriptionQueryOptions } from "@/lib/queries/subscriptions";
import { formatPlanPrice } from "@/lib/subscription-plans";
import type { PublicCreditPack } from "@/lib/credit-packs";
import { useAuth } from "@/hooks/use-auth";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";

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

      {!!packs?.length && (
        <section className="mx-auto mt-16 max-w-5xl sm:mt-20">
          <header className="text-center">
            <p className="atelier-kicker mb-3">Credit packs</p>
            <h2 className="font-serif text-2xl text-ink sm:text-3xl">
              {subscribed ? "Out of credits before the day resets?" : "A membership extra"}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
              {subscribed
                ? "Top up with a pack and keep styling with Mila today. Pack credits are used after your daily allowance runs out, and they never expire."
                : "Credit packs top up your balance on days you run through your allowance. They're available to members only — choose a membership above to unlock them."}
            </p>
          </header>

          <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {packs.map((pack) => (
              <CreditPackCard
                key={pack.id}
                pack={pack}
                locked={!subscribed}
                disabled={!ready}
                onBuy={
                  user && subscribed
                    ? () => openCheckout(pack, { id: user.id, email: user.email })
                    : undefined
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CreditPackCard({
  pack,
  locked,
  disabled,
  onBuy,
}: {
  pack: PublicCreditPack;
  locked: boolean;
  disabled?: boolean;
  onBuy?: () => void;
}) {
  // A pack with no Paddle price can't open a checkout — say so rather than
  // handing over a button that silently does nothing.
  const unavailable = !pack.paddle_price_id;

  return (
    <li className="atelier-card flex flex-col p-6">
      <div className="flex items-center gap-2">
        {locked ? (
          <Lock className="size-4 text-muted" aria-hidden="true" strokeWidth={1.75} />
        ) : (
          <Zap className="size-4 text-accent" aria-hidden="true" strokeWidth={1.75} />
        )}
        <h3 className="font-serif text-xl text-ink">{pack.title}</h3>
      </div>

      <p className="mt-3 text-sm text-ink tabular-nums">
        {pack.credits} styling {pack.credits === 1 ? "credit" : "credits"}
      </p>
      {pack.description && (
        <p className="mt-2 text-sm leading-relaxed text-muted">{pack.description}</p>
      )}

      <p className="mt-5 font-display text-3xl font-bold tracking-tight text-ink tabular-nums">
        {formatPlanPrice(pack.price_amount, pack.currency)}
      </p>

      <div className="mt-auto pt-6">
        <Button
          type="button"
          onClick={onBuy}
          disabled={disabled || locked || unavailable || !onBuy}
          variant="secondary"
          className="w-full"
        >
          {locked ? "Members only" : unavailable ? "Coming soon" : "Buy Pack"}
        </Button>
      </div>
    </li>
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
