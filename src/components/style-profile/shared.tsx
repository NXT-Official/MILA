import { motion } from "framer-motion";
import { Check, CheckCircle2, Circle, Plus, ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  BEAUTY_PREFERENCE_TAGS,
  type MatrixOption,
  type NamedSwatch,
} from "@/constants/style-profile";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

/**
 * Back to the dashboard on the left, the sibling page on the right — the
 * dossier and Studio each point at the other.
 */
export function DossierTopBar({ counterpart }: { counterpart: "studio" | "profile" }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Link
        to="/dashboard"
        className="atelier-focus-ring inline-flex items-center gap-1.5 rounded-control text-micro uppercase tracking-label-wide text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back
      </Link>
      <Link
        to={counterpart === "studio" ? "/style-profile" : "/profile"}
        className="atelier-focus-ring rounded-control text-micro uppercase tracking-label-wide text-accent transition-colors hover:text-foreground"
      >
        {counterpart === "studio" ? "Open Studio" : "View Profile"} →
      </Link>
    </div>
  );
}

/** Eyebrow + title + optional subtitle. One header shape for every section. */
export function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-nano uppercase tracking-label-max text-muted-foreground">{eyebrow}</p>
      <h2 className="font-serif text-2xl leading-tight tracking-tight text-foreground">{title}</h2>
      {subtitle ? (
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  );
}

/**
 * One dossier fact, at a glance. An unset field with somewhere to go shows the
 * way there instead of an em dash — the grid doubles as the completion prompt.
 */
export function DetailChip({
  label,
  value,
  onAdd,
}: {
  label: string;
  value?: string | null;
  onAdd?: () => void;
}) {
  const empty = !value;
  return (
    <div
      className={cn(
        "rounded-control px-3 py-2.5",
        empty ? "border border-dashed border-border" : "border-[0.5px] border-border bg-card",
      )}
    >
      <p className="text-nano uppercase tracking-label-xwide text-muted-foreground">{label}</p>
      {value ? (
        <p className="mt-0.5 truncate text-sm text-foreground" title={value}>
          {value}
        </p>
      ) : onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="atelier-focus-ring mt-0.5 inline-flex items-center gap-1 rounded-control text-sm text-accent transition-colors hover:text-foreground"
        >
          <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
          Add
        </button>
      ) : (
        <p className="mt-0.5 text-sm text-muted-foreground/60">—</p>
      )}
    </div>
  );
}

/**
 * Soft nudge for dossier fields Mila can work without. Deliberately not an
 * error: the look still composes, it just loses the hair and framing detail —
 * so this says what gets worse, not that something is broken.
 */
export function MissingDetailsNudge({
  missing,
  onOpenDetailed,
}: {
  missing: string[];
  onOpenDetailed: () => void;
}) {
  if (missing.length === 0) return null;
  const names = missing.join(" and ").toLowerCase();
  return (
    <div className="rounded-card border-[0.5px] border-border bg-accent-soft/60 p-6">
      <p className="text-nano uppercase tracking-label-max text-muted-foreground">
        Complete your profile
      </p>
      <p className="mt-3 font-serif text-xl leading-snug text-foreground">
        Add your {names}
        <span className="text-muted-foreground">
          {" "}
          · Mila&rsquo;s recommendations get more specific.
        </span>
      </p>
      <Button size="pill" className="mt-5" onClick={onOpenDetailed}>
        Complete details
      </Button>
    </div>
  );
}

/** One Style DNA fact: title, optional swatch bar, body, optional gold action. */
export function DNACard({
  title,
  body,
  swatches,
  tone,
  action,
}: {
  title: string;
  body: string;
  swatches?: string[];
  tone?: "muted";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      className={cn(
        "rounded-card border-[0.5px] p-4",
        tone === "muted" ? "border-border/60 bg-surface/40" : "border-border bg-card shadow-paper",
      )}
    >
      <h3 className="font-serif text-base text-foreground">{title}</h3>
      {swatches && swatches.length > 0 ? (
        <div className="mt-3 flex overflow-hidden rounded-md" aria-hidden="true">
          {swatches.map((hex, i) => (
            <div key={`${hex}-${i}`} className="h-6 flex-1" style={{ backgroundColor: hex }} />
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-foreground/85">{body}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="atelier-focus-ring mt-3 inline-flex items-center gap-1 rounded-control text-xs font-medium text-accent hover:underline"
        >
          {action.label} →
        </button>
      ) : null}
    </div>
  );
}

/**
 * A named band of the season palette. Every swatch is a button because the
 * guidance — why this colour, where to wear it — is the point; a grid of
 * unlabelled squares is decoration.
 */
export function PaletteBand({
  label,
  swatches,
  muted = false,
}: {
  label: string;
  swatches: NamedSwatch[];
  muted?: boolean;
}) {
  if (swatches.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-nano uppercase tracking-label-max text-muted-foreground">{label}</p>
      <div className={cn("grid grid-cols-4 gap-2 sm:grid-cols-6", muted && "opacity-80")}>
        {swatches.map((s) => (
          <Popover key={s.hex + s.name}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`${s.name} — ${s.tip}`}
                className="atelier-focus-ring aspect-square rounded-control border-[0.5px] border-border transition-transform hover:scale-105"
                style={{ backgroundColor: s.hex }}
              />
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-64 rounded-card p-4">
              <div className="flex items-center gap-3">
                <div
                  aria-hidden="true"
                  className="size-10 shrink-0 rounded-lg border-[0.5px] border-border"
                  style={{ backgroundColor: s.hex }}
                />
                <div className="min-w-0">
                  <p className="font-serif text-base leading-tight text-foreground">{s.name}</p>
                  <p className="text-nano uppercase tracking-label-wide text-muted-foreground">
                    {s.hex}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-foreground/85">{s.tip}</p>
              {s.use ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">Best for:</span> {s.use}
                </p>
              ) : null}
            </PopoverContent>
          </Popover>
        ))}
      </div>
    </div>
  );
}

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
      <span className="text-nano uppercase tracking-label-xwide text-foreground/75">{label}</span>
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
            className="relative px-5 sm:px-7 py-2.5 text-micro uppercase tracking-label-xwide z-10"
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
  id,
  eyebrow,
  title,
  caption,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-4">
      <div className="space-y-1.5">
        {eyebrow && <p className="text-nano uppercase tracking-label-max text-accent">{eyebrow}</p>}
        <h3 className="font-serif text-2xl tracking-tight text-foreground">{title}</h3>
        {caption && (
          <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">{caption}</p>
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
      className="border-[0.5px] border-border bg-white/40 dark:bg-white/5 backdrop-blur-xl rounded-card px-5 sm:px-8"
    >
      <AccordionTrigger className="py-6 hover:no-underline">
        <div className="flex items-center justify-between w-full gap-3">
          <div className="flex flex-col items-start text-left gap-1">
            <p className="text-micro uppercase tracking-label-max text-accent">
              {eyebrow.split(" / ")[0]}
            </p>
            <h2 className="font-serif text-xl sm:text-2xl tracking-tight text-foreground">
              {eyebrow.split(" / ")[1] ?? eyebrow}
            </h2>
            <p className="text-label text-muted-foreground leading-relaxed max-w-md mt-1">
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
              <span className="text-micro uppercase tracking-label-wide">
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

const DISRUPTIVE_TONE_HEX: Record<string, string> = {
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

function hexForTone(name: string): string {
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
  tags = BEAUTY_PREFERENCE_TAGS,
  limit,
}: {
  active: string[];
  onToggle: (tag: string) => void;
  /** Defaults to the beauty tags; style goals reuse the same tray. */
  tags?: readonly string[];
  /** Once reached, unselected pills go inert rather than failing at the DB. */
  limit?: number;
}) {
  const full = limit != null && active.length >= limit;
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const isActive = active.includes(tag);
        const locked = full && !isActive;
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onToggle(tag)}
            disabled={locked}
            aria-pressed={isActive}
            className={[
              "inline-flex items-center gap-2 px-4 py-2.5 border rounded-full transition-all duration-200",
              "text-label uppercase tracking-label-wide",
              isActive
                ? "bg-accent-soft border-accent text-ink"
                : locked
                  ? "bg-card border-border text-muted-foreground/40 cursor-not-allowed"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-accent/40",
            ].join(" ")}
          >
            {isActive ? <Check className="size-3.5" aria-hidden="true" /> : null}
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
