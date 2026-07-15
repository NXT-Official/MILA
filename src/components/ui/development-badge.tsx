import { Construction } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function DevelopmentBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 border-line bg-accent-soft text-ink", className)}
    >
      <Construction aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
      In development
    </Badge>
  );
}
