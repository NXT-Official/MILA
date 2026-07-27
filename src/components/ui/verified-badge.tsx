import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shown next to a member's name when they hold an in-force Atelier membership. */
export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <BadgeCheck
      role="img"
      aria-label="Verified member"
      className={cn("size-3.5 shrink-0 text-accent", className)}
      strokeWidth={2}
    />
  );
}
