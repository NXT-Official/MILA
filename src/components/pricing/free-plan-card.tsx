import { Check, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FREE_PLAN } from "@/components/pricing/free-plan";
import { formatPlanPrice } from "@/lib/subscription-plans";

/**
 * The Free column beside the paid plans, so a visitor can see what a
 * membership adds. Its content is `FREE_PLAN`, read from the code. It has no
 * checkout: every account starts here.
 */
export function FreePlanCard({ currency }: { currency: string }) {
  return (
    <Card asChild className="relative flex flex-col p-6 sm:p-8">
      <li aria-label={FREE_PLAN.title}>
        <h3 className="font-serif text-2xl text-ink">{FREE_PLAN.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">{FREE_PLAN.description}</p>

        <p className="mt-6">
          <span className="font-display text-4xl font-bold tracking-tight text-ink tabular-nums">
            {formatPlanPrice(0, currency)}
          </span>
          <span className="ml-2 text-xs uppercase tracking-label text-muted">/ month</span>
        </p>

        <ul className="mt-6 space-y-2.5 border-t border-line pt-6">
          <li className="flex items-start gap-2.5 text-sm leading-relaxed text-ink">
            <Minus
              className="mt-1 size-3.5 shrink-0 text-muted"
              aria-hidden="true"
              strokeWidth={2}
            />
            <span className="min-w-0 wrap-break-words">{FREE_PLAN.creditLine}</span>
          </li>
          {FREE_PLAN.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink">
              <Check
                className="mt-1 size-3.5 shrink-0 text-accent"
                aria-hidden="true"
                strokeWidth={2}
              />
              <span className="min-w-0 wrap-break-words">{feature}</span>
            </li>
          ))}
        </ul>
      </li>
    </Card>
  );
}
