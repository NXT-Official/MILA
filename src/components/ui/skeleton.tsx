import { cn } from "@/lib/utils";

/** A pulsing placeholder box. Shape, size and tint come from className. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-foreground/6", className)} />;
}
