import type { LucideIcon } from "lucide-react";

export function AdminStatCard({
  icon: Icon,
  label,
  value,
  sublabel,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="rounded-panel border border-porcelain/60 bg-atelier-panel/40 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-[0.22em] text-stone">{label}</span>
        <Icon className="size-4 text-accent" strokeWidth={1.75} />
      </div>
      <div className="font-serif text-3xl text-ink">{value}</div>
      {sublabel && (
        <div className="text-[10px] uppercase tracking-[0.18em] text-stone">{sublabel}</div>
      )}
    </div>
  );
}
