import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sparkles } from "lucide-react";

export type PremiumTrigger = "dupes" | "blueprint" | "credits";

const COPY: Record<PremiumTrigger, { eyebrow: string; title: string; description: string }> = {
  dupes: {
    eyebrow: "Atelier · Lens",
    title: "Unlimited Dupe Hunting",
    description:
      "You've uncovered today's style matches. Unlock unlimited luxury Dupe Hunting and instantly source the budget-friendly alternatives our concierge curates each day.",
  },
  blueprint: {
    eyebrow: "Atelier · Daily Look",
    title: "Your Full Editorial Blueprint",
    description:
      "Today's silhouette is just the opening note. Unlock the complete styling blueprint — hair, makeup, accessories, and the full shopping breakdown.",
  },
  credits: {
    eyebrow: "Atelier · Studio",
    title: "You've reached today's atelier limit",
    description:
      "You've used your daily complimentary credits. Continue refining your wardrobe with unlimited Studio sessions, Lens analyses, and concierge consultations.",
  },
};

const BENEFITS = [
  "Unlimited Lens analyses & Dupe Hunter searches",
  "Full daily styling blueprint — hair, beauty, accessories",
  "Priority concierge with editorial styling notes",
  "Early access to atelier drops & curated archive",
];

export interface MilaPremiumModalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerReason: PremiumTrigger;
  onSubscribe?: () => void;
}

export function MilaPremiumModal({ isOpen, onClose, triggerReason, onSubscribe }: MilaPremiumModalProps) {
  const copy = COPY[triggerReason];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden rounded-none border-[0.5px] border-border bg-[#F5F5F0] text-[#1A1A1A] shadow-[0_30px_90px_-20px_rgba(0,0,0,0.25)]">
        {/* Hairline frame */}
        <div className="absolute inset-3 pointer-events-none border-[0.5px] border-foreground/15" />

        <div className="relative px-8 pt-10 pb-6">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.42em] text-muted-foreground font-semibold">
            <span className="h-px w-6 bg-foreground/60" />
            {copy.eyebrow}
          </div>

          <DialogHeader className="mt-5 space-y-3 text-left">
            <DialogTitle className="font-serif text-3xl leading-[1.1] tracking-[-0.01em]">
              {copy.title}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-foreground/70 font-light">
              {copy.description}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="relative px-8 pb-2">
          <ul className="space-y-2.5 border-t-[0.5px] border-foreground/15 pt-5">
            {BENEFITS.map((b) => (
              <li key={b} className="flex items-start gap-3 text-[12px] tracking-wide text-foreground/80">
                <Sparkles className="h-3 w-3 mt-1 text-foreground/60 flex-none" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative px-8 pt-6 pb-8 space-y-3">
          <div className="flex items-baseline justify-between border-t-[0.5px] border-foreground/15 pt-5">
            <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground font-semibold">
              Atelier Membership
            </p>
            <p className="font-serif text-xl tracking-tight">
              $9.99<span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground ml-1">/ mo</span>
            </p>
          </div>

          <button
            type="button"
            onClick={onSubscribe}
            className="w-full bg-[#1A1A1A] text-[#F5F5F0] font-semibold uppercase tracking-[0.3em] text-[11px] py-4 rounded-none hover:bg-[#1A1A1A]/90 transition"
          >
            Unlock Unlimited Access
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full text-[10px] uppercase tracking-[0.32em] text-muted-foreground py-2 hover:text-foreground transition"
          >
            Maybe Later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}