import { Sparkles, Zap } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DevelopmentNotice } from "@/components/ui/development-notice";

const CREDIT_PACKS = [
  {
    id: "mila_pack_small",
    name: "Mila Daily Pack",
    description: "+10 styling credits — a week of effortless looks.",
    price: "$1.99",
  },
  {
    id: "mila_pack_large",
    name: "Mila Studio Pack",
    description: "+50 styling credits — for the seriously well-dressed.",
    price: "$5.99",
  },
  {
    id: "mila_pack_unlimited",
    name: "Mila Unlimited",
    description: "Unlimited daily styling — your studio never closes.",
    price: "$14.99",
  },
];

export function UpgradeSlotsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  variant?: "credits";
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mx-auto sm:mx-0 mb-2 inline-flex items-center justify-center size-12 rounded-full bg-atelier-champagne/20 ring-1 ring-atelier-champagne/40">
            <Zap className="size-5 text-foreground" strokeWidth={1.75} />
          </div>
          <DialogTitle className="font-serif text-2xl">Studio Energy Depleted</DialogTitle>
          <DialogDescription>
            You've used today's complimentary styling credits. Upgrade your membership for a
            bigger daily allowance, or check out one-time credit packs below.
          </DialogDescription>
        </DialogHeader>

        <Button asChild className="w-full" onClick={() => onOpenChange(false)}>
          <Link to="/pricing">View Membership Plans</Link>
        </Button>

        <div className="mt-2 space-y-3">
          {CREDIT_PACKS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled
              aria-describedby="credit-purchases-development-message"
              className="w-full flex items-center justify-between gap-4 border border-border p-4 text-left opacity-60 cursor-not-allowed"
            >
              <div className="flex items-start gap-3">
                <Sparkles className="size-4 mt-0.5 text-atelier-champagne" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                </div>
              </div>
              <span className="text-sm font-medium shrink-0">{p.price}</span>
            </button>
          ))}
        </div>

        <DevelopmentNotice
          id="credit-purchases-development-message"
          className="mt-4"
          description="This action is not available yet. Your existing daily credits still work as usual."
        />
      </DialogContent>
    </Dialog>
  );
}
