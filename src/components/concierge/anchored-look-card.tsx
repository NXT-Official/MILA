import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConciergeLook } from "@/hooks/use-concierge";
import { LookThumbnail } from "@/components/concierge/look-thumbnail";

export function AnchoredLookCard({
  look,
  onClear,
  className,
}: {
  look: ConciergeLook;
  onClear: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-foreground/10 bg-background/50 p-2.5 shadow-sm",
        className,
      )}
    >
      <div className="size-14 rounded-lg bg-muted overflow-hidden shrink-0 ring-1 ring-foreground/5">
        <LookThumbnail imageUrl={look.imageUrl} title={look.title} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight truncate">{look.title}</p>
        <p className="text-micro uppercase tracking-label-wide text-muted-foreground mt-0.5 truncate">
          {look.source}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove this look from the conversation"
        className="shrink-0 p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
      >
        <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
