import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function LoadingState({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 py-14 text-muted", className)}
      role="status"
    >
      <Loader2 className="size-6 animate-spin text-accent" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
