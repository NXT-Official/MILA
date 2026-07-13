import { Sparkles, Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DevelopmentBadge } from "@/components/ui/development-badge";
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

// IN DEVELOPMENT [credit-purchases]:
// No payment provider is integrated yet. Buy-pack controls are disabled so
// the client can never trigger a fake purchase.
// See /IN_DEVELOPMENT.txt.
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
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="font-serif text-2xl">Studio Energy Depleted</DialogTitle>
            <DevelopmentBadge />
          </div>
          <DialogDescription>
            Your complimentary daily styling credits have been filled for the session. Credit packs
            are previewed below — purchasing isn't available yet.
          </DialogDescription>
        </DialogHeader>

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
