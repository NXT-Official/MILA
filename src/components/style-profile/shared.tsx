import { motion } from "framer-motion";
import { Check, CheckCircle2, Circle } from "lucide-react";
import { AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { BEAUTY_PREFERENCE_TAGS, type MatrixOption } from "@/constants/style-profile";

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
      ? "bg-amber-500 animate-pulse"
      : status === "error"
        ? "bg-red-500"
        : status === "synced"
          ? "bg-emerald-600"
          : "bg-foreground/30";
  return (
    <div className="hidden sm:flex items-center gap-2 px-3 py-2 backdrop-blur-xl bg-white/40 dark:bg-white/5 border border-foreground/10 rounded-full shrink-0">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="text-[9px] uppercase tracking-[0.34em] text-foreground/75">{label}</span>
    </div>
  );
}

export function PerspectiveSwitcher({
  value,
  onChange,
}: {
  value: "streamlined" | "detailed";
  onChange: (v: "streamlined" | "detailed") => void;
}) {
  const opts: Array<{ id: "streamlined" | "detailed"; label: string }> = [
    { id: "streamlined", label: "Streamlined" },
    { id: "detailed", label: "Detailed Dossier" },
  ];
  return (
    <div className="inline-flex relative p-1 rounded-full backdrop-blur-xl bg-white/45 dark:bg-white/5 border border-foreground/10 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset] dark:shadow-none">
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className="relative px-5 sm:px-7 py-2.5 text-[10px] uppercase tracking-[0.34em] z-10"
          >
            {active && (
              <motion.span
                layoutId="perspective-pill"
                className="absolute inset-0 rounded-full bg-foreground"
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
              />
            )}
            <span className={`relative ${active ? "text-background" : "text-foreground/55"}`}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function DossierField({
  eyebrow,
  title,
  caption,
  children,
}: {
  eyebrow?: string;
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        {eyebrow && <p className="text-[9px] uppercase tracking-[0.42em] text-accent">{eyebrow}</p>}
        <h3 className="font-serif text-2xl tracking-tight text-foreground">{title}</h3>
        {caption && (
          <p className="text-[12px] text-muted-foreground leading-relaxed max-w-xl">{caption}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function DossierAccordion({
  value,
  eyebrow,
  caption,
  children,
  filled,
  total,
}: {
  value: string;
  eyebrow: string;
  caption: string;
  children: React.ReactNode;
  filled?: number;
  total?: number;
}) {
  const hasProgress = typeof filled === "number" && typeof total === "number" && total > 0;
  const complete = hasProgress && filled >= total;
  const partial = hasProgress && filled > 0 && filled < total;
  return (
    <AccordionItem
      value={value}
      className="border-[0.5px] border-border bg-white/40 dark:bg-white/5 backdrop-blur-xl rounded-none px-5 sm:px-8"
    >
      <AccordionTrigger className="py-6 hover:no-underline">
        <div className="flex items-center justify-between w-full gap-3">
          <div className="flex flex-col items-start text-left gap-1">
            <p className="text-[10px] uppercase tracking-[0.42em] text-accent">
              {eyebrow.split(" / ")[0]}
            </p>
            <h2 className="font-serif text-xl sm:text-2xl tracking-tight text-foreground">
              {eyebrow.split(" / ")[1] ?? eyebrow}
            </h2>
            <p className="text-[11px] text-muted-foreground leading-relaxed max-w-md mt-1">
              {caption}
            </p>
          </div>
          {complete && (
            <CheckCircle2
              className="size-5 text-emerald-600 shrink-0"
              aria-label="Section complete"
            />
          )}
          {partial && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground shrink-0">
              <Circle className="size-4" />
              <span className="text-[10px] uppercase tracking-[0.22em]">
                {filled}/{total}
              </span>
            </span>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-8 pt-2 space-y-8">{children}</AccordionContent>
    </AccordionItem>
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
              "text-[11px] uppercase tracking-[0.22em] rounded-full",
              active
                ? "bg-accent-soft border-accent text-ink"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-[#C9A96E]/40",
            ].join(" ")}
          >
            <span>{o}</span>
          </button>
        );
      })}
    </div>
  );
}

export const DISRUPTIVE_TONE_HEX: Record<string, string> = {
  "High-Contrast Black": "#0B0B0F",
  "Bleached White": "#F4F4F0",
  "Vivid Primaries": "#D72638",
  "Harsh Chartreuse": "#B6C24A",
  "Warm Orange": "#D97A3A",
  "Heavy Rust": "#7A3A24",
  Mustard: "#C9A227",
  Magenta: "#B23A7A",
  "Pure Black": "#0B0B0F",
  Black: "#0B0B0F",
  "Pure White": "#F4F4F0",
};

export function hexForTone(name: string): string {
  if (DISRUPTIVE_TONE_HEX[name]) return DISRUPTIVE_TONE_HEX[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(DISRUPTIVE_TONE_HEX)) {
    if (lower.includes(k.toLowerCase())) return v;
  }
  return "#8A6F6F";
}

export function DisruptiveToneCard({ name, height = 56 }: { name: string; height?: number }) {
  const hex = hexForTone(name);
  return (
    <div
      className="w-full rounded-xl overflow-hidden flex items-stretch border border-destructive/20 bg-[#FFF0F0] dark:bg-destructive/10"
      style={{ minHeight: height }}
    >
      <div className="w-1/4 shrink-0" style={{ backgroundColor: hex }} />
      <div className="flex-1 flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-[11px] uppercase tracking-[0.22em] text-foreground font-medium leading-tight">
          {name}
        </span>
        <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-destructive/15 text-destructive text-[9px] uppercase tracking-[0.22em] font-semibold">
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
              "text-[11px] uppercase tracking-[0.22em]",
              isActive
                ? "bg-accent-soft border-accent text-ink"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-[#C9A96E]/40",
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
        <p className="text-[10px] uppercase tracking-[0.42em] text-accent whitespace-nowrap">
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
                    className={`text-[12px] uppercase tracking-[0.26em] ${active ? "text-foreground" : "text-foreground/85"}`}
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
