import { Sparkles, Zap } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";
import { publicCreditPacksQueryOptions } from "@/lib/queries/credit-packs";
import { formatPlanPrice } from "@/lib/subscription-plans";

export function UpgradeSlotsDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  user: { id: string; email?: string } | null | undefined;
}) {
  const { data: packs } = useQuery({
    ...publicCreditPacksQueryOptions(),
    enabled: open,
  });
  const { openCheckout, ready } = usePaddleCheckout(user?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mx-auto sm:mx-0 mb-2 inline-flex items-center justify-center size-12 rounded-full bg-atelier-champagne/20 ring-1 ring-atelier-champagne/40">
            <Zap className="size-5 text-foreground" strokeWidth={1.75} />
          </div>
          <DialogTitle className="font-serif text-2xl">Studio Energy Depleted</DialogTitle>
          <DialogDescription>
            You've used today's complimentary styling credits. Upgrade your membership for a bigger
            daily allowance, or top up now to keep going today.
          </DialogDescription>
        </DialogHeader>

        <Button asChild className="w-full" onClick={() => onOpenChange(false)}>
          <Link to="/pricing">View Membership Plans</Link>
        </Button>

        {packs && packs.length > 0 && (
          <div className="mt-2 space-y-3">
            {packs.map((pack) => (
              <button
                key={pack.id}
                type="button"
                disabled={!ready || !user?.id}
                onClick={() => user?.id && openCheckout(pack, { id: user.id, email: user.email })}
                className="w-full flex items-center justify-between gap-4 border border-border p-4 text-left hover:border-foreground/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div className="flex items-start gap-3">
                  <Sparkles className="size-4 mt-0.5 text-atelier-champagne" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">{pack.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {pack.description || `+${pack.credits} styling credits`}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-medium shrink-0">
                  {formatPlanPrice(pack.price_amount, pack.currency)}
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
