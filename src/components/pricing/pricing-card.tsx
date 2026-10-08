import { Check, Loader2, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import {
  BILLING_INTERVAL_SUFFIX,
  formatPlanPrice,
  type PublicSubscriptionPlan,
} from "@/lib/subscription-plans";
import { monthlyEquivalentCents, type PlanStanding } from "@/components/pricing/plan-value";
import { SHOW_CREDIT_PACKS } from "@/components/pricing/credit-packs";

export function PricingCard({
  plan,
  standing,
  onChoosePlan,
  disabled,
  loading,
  unavailable,
}: {
  plan: PublicSubscriptionPlan;
  /** The badge this plan earns against the others (`planStanding`). Without
   * the other plans to compare, a featured plan is only "Featured": the card
   * never claims "Recommended" on a basis it can't show. */
  standing?: PlanStanding | null;
  onChoosePlan?: () => void;
  disabled?: boolean;
  /** True while checkout is still initializing (e.g. Paddle.js loading):
   * shows a spinner so a disabled button doesn't read as broken. */
  loading?: boolean;
  /** True when checkout cannot work at all (Paddle env config missing):
   * says so instead of spinning forever. */
  unavailable?: boolean;
}) {
  const price = formatPlanPrice(plan.price_amount, plan.currency);
  const interval = BILLING_INTERVAL_SUFFIX[plan.billing_interval];
  const badge =
    standing === undefined
      ? plan.is_featured
        ? ({ label: "Featured", basis: null } satisfies PlanStanding)
        : null
      : standing;
  const monthly = plan.billing_interval === "yearly" ? monthlyEquivalentCents(plan) : null;

  return (
    <Card
      asChild
      className={cn(
        "relative flex flex-col p-6 sm:p-8",
        plan.is_featured &&
          "border-accent/70 shadow-atelier-soft ring-1 ring-accent/30 lg:-translate-y-2",
      )}
    >
      <li aria-label={badge ? `${plan.title}, ${badge.label.toLowerCase()}` : plan.title}>
        {badge && (
          <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1.5 border border-accent/50 bg-accent-soft text-ink shadow-paper">
            <Sparkles aria-hidden="true" className="size-3" strokeWidth={1.75} />
            {badge.label}
          </Badge>
        )}

        <h3 className="font-serif text-2xl text-ink">{plan.title}</h3>
        {plan.description && (
          <p className="mt-2 text-sm leading-relaxed text-muted">{plan.description}</p>
        )}

        <p className="mt-6">
          <span className="font-display text-4xl font-bold tracking-tight text-ink tabular-nums">
            {price}
          </span>
          <span className="ml-2 text-xs uppercase tracking-label text-muted">{interval}</span>
        </p>
        {monthly !== null && (
          <p className="mt-1.5 text-sm text-muted tabular-nums">
            {formatPlanPrice(monthly, plan.currency)} a month, billed yearly
          </p>
        )}
        {badge?.basis && <p className="mt-3 text-sm font-semibold text-ink">{badge.basis}</p>}

        <ul className="mt-6 space-y-2.5 border-t border-line pt-6">
          {plan.credits_included > 0 && (
            <PlanFeature text={`${plan.credits_included} styling credits per day`} />
          )}
          {plan.features.map((feature) => (
            <PlanFeature key={feature} text={feature} />
          ))}
          {/* Hidden while no pack can be bought (see credit-packs.ts). */}
          {SHOW_CREDIT_PACKS && <PlanFeature text="Credit packs to top up any day" />}
          <li className="flex items-start gap-2.5 text-sm leading-relaxed text-ink">
            <VerifiedBadge className="mt-0.5" />
            <span className="min-w-0 wrap-break-words">
              Verified badge on your profile and posts
            </span>
          </li>
        </ul>

        <div className="mt-auto pt-8">
          <Button
            type="button"
            onClick={onChoosePlan}
            disabled={disabled || unavailable || !plan.paddle_price_id || !onChoosePlan}
            variant={plan.is_featured ? "primary" : "secondary"}
            className="w-full"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Preparing checkout…
              </span>
            ) : unavailable ? (
              "Checkout is unavailable right now"
            ) : (
              "Choose Plan"
            )}
          </Button>
          <p className="mt-3 text-center text-micro leading-relaxed text-muted">
            By subscribing you agree to our{" "}
            <Link to="/privacy" className="atelier-focus-ring rounded underline hover:text-ink">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link to="/terms" className="atelier-focus-ring rounded underline hover:text-ink">
              Terms
            </Link>
            .
          </p>
        </div>
      </li>
    </Card>
  );
}

function PlanFeature({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-relaxed text-ink">
      <Check className="mt-1 size-3.5 shrink-0 text-accent" aria-hidden="true" strokeWidth={2} />
      <span className="min-w-0 wrap-break-words">{text}</span>
    </li>
  );
}
