import { Check } from "lucide-react";
import { BEAUTY_PREFERENCE_TAGS, type MatrixOption } from "@/constants/style-profile";
import { avoidSwatchHex } from "@/components/style-profile/dossier-display";

export function SyncBadge({ status }: { status: "idle" | "syncing" | "synced" | "error" }) {
  const label =
    status === "syncing"
      ? "Syncing…"
      : status === "error"
        ? "Sync Paused"
        : status === "synced"
          ? "Dossier Synced"
          : "Awaiting Edits";
  const dot =
    status === "syncing"
      ? "bg-warning animate-pulse"
      : status === "error"
        ? "bg-destructive"
        : status === "synced"
          ? "bg-success"
          : "bg-foreground/30";
  return (
    <>
      <div className="hidden sm:flex items-center gap-2 px-3 py-2 atelier-glass rounded-full shrink-0">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-nano uppercase tracking-label-xwide text-foreground/75">{label}</span>
      </div>
      <span
        className={`sm:hidden inline-flex size-2.5 rounded-full shrink-0 ${dot}`}
        role="status"
        aria-label={label}
      />
    </>
  );
}

export function PillRow({
  value,
  options,
  onSelect,
}: {
  value: string | null;
  options: string[];
  onSelect: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onSelect(o)}
            className={[
              "group inline-flex items-center gap-2 px-4 py-2.5 border transition-all duration-200",
              "text-label uppercase tracking-label-wide rounded-full",
              active
                ? "bg-accent-soft border-accent text-ink"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-accent/40",
            ].join(" ")}
          >
            <span>{o}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DisruptiveToneCard({ name, height = 56 }: { name: string; height?: number }) {
  const hex = avoidSwatchHex(name);
  return (
    <div
      className="w-full rounded-xl overflow-hidden flex items-stretch border border-destructive/20 bg-destructive/10"
      style={{ minHeight: height }}
    >
      {hex && <div className="w-1/4 shrink-0" style={{ backgroundColor: hex }} />}
      <div className="flex-1 flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-label uppercase tracking-label-wide text-foreground font-medium leading-tight">
          {name}
        </span>
        <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-destructive/15 text-destructive text-nano uppercase tracking-label-wide font-semibold">
          Avoid
        </span>
      </div>
    </div>
  );
}

export function BeautyPillTray({
  active,
  onToggle,
}: {
  active: string[];
  onToggle: (tag: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {BEAUTY_PREFERENCE_TAGS.map((tag) => {
        const isActive = active.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onToggle(tag)}
            className={[
              "inline-flex items-center gap-2 px-4 py-2.5 border rounded-full transition-all duration-200",
              "text-label uppercase tracking-label-wide",
              isActive
                ? "bg-accent-soft border-accent text-ink"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-accent/40",
            ].join(" ")}
          >
            <span>{tag}</span>
          </button>
        );
      })}
    </div>
  );
}
export function CardMatrix({
  label,
  value,
  onPick,
  options,
}: {
  label: string;
  value: string;
  onPick: (v: string) => void;
  options: MatrixOption[];
}) {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <p className="text-micro uppercase tracking-label-max text-accent whitespace-nowrap">
          {label}
        </p>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onPick(o.value)}
              className={`group relative text-left rounded-card p-5 sm:p-6 min-h-30 transition-all duration-300 bg-card hover:bg-card shadow-paper ${
                active
                  ? "border border-foreground bg-foreground/4 ring-1 ring-foreground -translate-y-px"
                  : "border border-transparent hover:border-foreground/20"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <p
                    className={`text-xs uppercase tracking-label-wide ${active ? "text-foreground" : "text-foreground/85"}`}
                  >
                    {o.title}
                  </p>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {o.description}
                  </p>
                </div>
                <span
                  className={`mt-0.5 size-5 shrink-0 rounded-full flex items-center justify-center transition-all ${active ? "bg-foreground text-background scale-100" : "border-[0.5px] border-border scale-90 opacity-60"}`}
                >
                  {active && <Check className="size-3" />}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
