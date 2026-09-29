import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface StatTileProps {
  label: string;
  value: string;
  icon: LucideIcon;
  loading?: boolean;
  error?: boolean;
  className?: string;
}

export function StatTile({ label, value, icon: Icon, loading, error, className }: StatTileProps) {
  return (
    <Card className={cn("flex items-center gap-3 p-4", className)}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-accent-soft/60 text-accent">
        <Icon className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-nano uppercase tracking-label text-muted-foreground">{label}</p>
        <p className="text-lg font-serif text-ink truncate">
          {loading ? "…" : error ? "—" : value}
        </p>
      </div>
    </Card>
  );
}
