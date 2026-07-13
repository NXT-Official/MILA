import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DevelopmentBadge } from "@/components/ui/development-badge";
import { cn } from "@/lib/utils";
import {
  BILLING_INTERVAL_SUFFIX,
  formatPlanPrice,
  type PublicSubscriptionPlan,
} from "@/lib/subscription-plans";

/**
 * One membership plan card for the /pricing page. Every value shown comes
 * from the Supabase `subscription_plans` row — nothing is hardcoded here.
 * Purchasing is not implemented yet, so the CTA is disabled and points at
 * the page-level DevelopmentNotice via `ctaDescribedById`.
 */
export function PricingCard({
  plan,
  ctaDescribedById,
}: {
  plan: PublicSubscriptionPlan;
  ctaDescribedById: string;
}) {
  const price = formatPlanPrice(plan.price_amount, plan.currency);
  const interval = BILLING_INTERVAL_SUFFIX[plan.billing_interval];

  return (
    <li
      aria-label={plan.is_featured ? `${plan.title} — recommended plan` : plan.title}
      className={cn(
        "atelier-card relative flex flex-col p-6 sm:p-8",
        plan.is_featured &&
          "border-accent/70 shadow-atelier-soft ring-1 ring-accent/30 lg:-translate-y-2",
      )}
    >
      {plan.is_featured && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1.5 border border-accent/50 bg-accent-soft text-ink shadow-paper">
          <Sparkles aria-hidden="true" className="size-3" strokeWidth={1.75} />
          Recommended
        </Badge>
      )}

      <h2 className="font-serif text-2xl text-ink">{plan.title}</h2>
      {plan.description && (
        <p className="mt-2 text-sm leading-relaxed text-muted">{plan.description}</p>
      )}

      <p className="mt-6">
        <span className="font-display text-4xl font-bold tracking-tight text-ink tabular-nums">
          {price}
        </span>
        <span className="ml-2 text-xs uppercase tracking-[0.18em] text-muted">{interval}</span>
      </p>

      {(plan.credits_included > 0 || plan.features.length > 0) && (
        <ul className="mt-6 space-y-2.5 border-t border-line pt-6">
          {plan.credits_included > 0 && (
            <PlanFeature text={`${plan.credits_included} styling credits included`} />
          )}
          {plan.features.map((feature) => (
            <PlanFeature key={feature} text={feature} />
          ))}
        </ul>
      )}

      {/* mt-auto keeps every CTA bottom-aligned regardless of card content. */}
      <div className="mt-auto pt-8">
        <Button
          type="button"
          disabled
          variant={plan.is_featured ? "primary" : "secondary"}
          className="w-full"
          aria-describedby={ctaDescribedById}
          aria-label={`Choose the ${plan.title} plan — purchasing is in development`}
        >
          Choose Plan
        </Button>
        <div className="mt-3 flex justify-center">
          <DevelopmentBadge />
        </div>
      </div>
    </li>
  );
}

function PlanFeature({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-relaxed text-ink">
      <Check className="mt-1 size-3.5 shrink-0 text-accent" aria-hidden="true" strokeWidth={2} />
      <span className="min-w-0 break-words">{text}</span>
    </li>
  );
}
