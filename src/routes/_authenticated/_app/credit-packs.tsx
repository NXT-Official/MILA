import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ScrollText, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorPanel } from "@/components/ui/error-state";
import { publicCreditPacksQueryOptions } from "@/lib/queries/credit-packs";
import { myMembershipStatus } from "@/lib/subscriptions.functions";
import { formatPlanPrice } from "@/lib/subscription-plans";
import type { PublicCreditPack } from "@/lib/credit-packs";
import { useAuth } from "@/hooks/use-auth";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";

export const Route = createFileRoute("/_authenticated/_app/credit-packs")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { active } = await myMembershipStatus();
    if (!active) throw redirect({ to: "/pricing" });
  },
  component: CreditPacksPage,
});

function CreditPacksPage() {
  const { data: packs, isLoading, isError, refetch } = useQuery(publicCreditPacksQueryOptions());
  const { user } = useAuth();
  const { openCheckout, ready } = usePaddleCheckout(user?.id);

  return (
    <div className="atelier-page max-w-5xl">
      <header className="mb-10 text-center sm:mb-14">
        <p className="atelier-kicker mb-3">Members only</p>
        <h1 className="atelier-title">Credit Packs</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted">
          Run out before the day resets? Top up and keep styling with Mila. Pack credits are spent
          only after your daily allowance is gone, and they never expire.
        </p>
      </header>

      {isLoading ? (
        <div
          role="status"
          aria-label="Loading credit packs"
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="atelier-card h-64 animate-pulse bg-foreground/6" />
          ))}
        </div>
      ) : isError ? (
        <LoadErrorPanel title="Couldn't load credit packs" onRetry={() => refetch()} />
      ) : !packs?.length ? (
        <EmptyState
          role="status"
          className="mx-auto max-w-xl"
          icon={<ScrollText className="size-8" strokeWidth={1.25} />}
          title="Credit packs are being prepared."
          description="Please check back soon."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((pack) => (
            <CreditPackCard
              key={pack.id}
              pack={pack}
              disabled={!ready}
              onBuy={
                user ? () => openCheckout(pack, { id: user.id, email: user.email }) : undefined
              }
            />
          ))}
        </ul>
      )}

      <p className="mt-10 text-center">
        <Link
          to="/pricing"
          className="inline-flex items-center gap-2 text-sm text-muted underline underline-offset-4 hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to membership plans
        </Link>
      </p>
    </div>
  );
}

function CreditPackCard({
  pack,
  disabled,
  onBuy,
}: {
  pack: PublicCreditPack;
  disabled?: boolean;
  onBuy?: () => void;
}) {
  const unavailable = !pack.paddle_price_id;

  return (
    <li className="atelier-card flex flex-col p-6">
      <div className="flex items-center gap-2">
        <Zap className="size-4 text-accent" aria-hidden="true" strokeWidth={1.75} />
        <h2 className="font-serif text-xl text-ink">{pack.title}</h2>
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
          disabled={disabled || unavailable || !onBuy}
          variant="secondary"
          className="w-full"
        >
          {unavailable ? "Coming soon" : "Buy Pack"}
        </Button>
      </div>
    </li>
  );
}
