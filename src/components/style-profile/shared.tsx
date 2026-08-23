import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Check, CheckCircle2, Circle, Plus, ArrowLeft, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  BEAUTY_PREFERENCE_TAGS,
  type Directive,
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
    // -my-2.5 keeps the 44px touch height off the visual rhythm of the page.
    <div className="-my-2.5 flex items-center justify-between gap-4">
      <Link
        to="/dashboard"
        className="atelier-focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-control text-label uppercase tracking-label text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back
      </Link>
      <Link
        to={counterpart === "studio" ? "/style-profile" : "/profile"}
        className="atelier-focus-ring inline-flex min-h-11 items-center rounded-control text-label uppercase tracking-label text-accent-ink transition-colors hover:text-foreground"
      >
        {counterpart === "studio" ? "Open Studio" : "View Profile"} →
      </Link>
    </div>
  );
}

/**
 * Title + optional subtitle, over a hairline. One header shape for every
 * section — the rule does the separating that a kicker above every heading
 * used to do.
 */
export function SectionHeader({
  title,
  subtitle,
  as: Heading = "h2",
}: {
  title: string;
  subtitle?: string;
  /** `h1` where the section header doubles as the page title. */
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className="space-y-1.5 border-t border-border pt-5">
      <Heading className="font-serif text-2xl leading-tight tracking-tight text-foreground">
        {title}
      </Heading>
      {subtitle ? (
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
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
  diagram,
}: {
  label: string;
  value?: string | null;
  onAdd?: () => void;
  /** Shape-based values (silhouette, face, hair) show the shape, not just its name. */
  diagram?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const empty = !value;
  // A field that just went from empty to set gets a brief accent flash that
  // settles back to the resting border — the only confirmation, next to the
  // sync badge, that an edit actually landed in the dossier.
  const [justFilled, setJustFilled] = useState(false);
  const wasEmptyRef = useRef(empty);
  useEffect(() => {
    if (wasEmptyRef.current && !empty && !reduce) {
      setJustFilled(true);
      const t = window.setTimeout(() => setJustFilled(false), 150);
      wasEmptyRef.current = empty;
      return () => window.clearTimeout(t);
    }
    wasEmptyRef.current = empty;
  }, [empty, reduce]);

  return (
    <div
      className={cn(
        "flex flex-col justify-between rounded-control px-3 py-2.5 transition-shadow duration-500",
        empty ? "border border-dashed border-border" : "border-[0.5px] border-border bg-card",
        justFilled && "ring-2 ring-accent",
      )}
    >
      {/* Two label lines are reserved whether or not this label needs them, so
          every value in a row sits on the same baseline. "Skin Lightness" wraps
          and "Contrast" does not; the grid should not show that. */}
      <p className="min-h-8 text-label uppercase leading-[1.4] tracking-label-tight text-muted-foreground">
        {label}
      </p>
      <div className="flex min-w-0 items-center justify-between gap-2">
        {value ? (
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.25, 1, 0.5, 1] }}
            className="line-clamp-2 text-sm text-foreground"
            title={value}
          >
            {value}
          </motion.p>
        ) : onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Add your ${label.toLowerCase()}`}
            className="atelier-focus-ring inline-flex items-center gap-1 rounded-control text-sm text-accent-ink transition-colors hover:text-foreground"
          >
            <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
            Add
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">Not set</p>
        )}
        {value ? diagram : null}
      </div>
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
  const reduce = useReducedMotion();
  const names = missing.join(" and ").toLowerCase();
  return (
    <AnimatePresence initial={false}>
      {missing.length > 0 && (
        <motion.div
          key="missing-details-nudge"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: reduce ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          style={{ overflow: "hidden" }}
        >
          <div className="rounded-card border-[0.5px] border-border bg-accent-soft/60 p-6">
            <p className="text-label uppercase tracking-label text-muted-foreground">
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * One styling directive: what to do about silhouette, hair, makeup or textile.
 *
 * Every named term is a tap target carrying its own definition, and colour terms
 * carry their swatch — a member who doesn't know what a peplum is, or what
 * "clear peach" looks like, can find out without leaving the card.
 */
export function DNACard({
  title,
  directive,
  rationale,
  fallback,
  action,
}: {
  title: string;
  directive?: Directive;
  /**
   * The dossier input this was derived from — stated so the advice connects.
   * Omit `value` when the input is one the hero already names (the season): the
   * link still gets drawn, without restating a fact that lives further up.
   */
  rationale?: { label: string; value?: string | null };
  /** Shown instead of the directive when the input it needs is missing. */
  fallback?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-card border-[0.5px] border-border bg-card p-4 shadow-paper">
      <h3 className="font-serif text-base text-foreground">{title}</h3>

      {directive && rationale ? (
        <p className="mt-2 text-label uppercase tracking-label text-muted-foreground">
          {rationale.value ? (
            <>
              Because your {rationale.label} is{" "}
              <span className="font-semibold text-accent-ink">{rationale.value}</span>
            </>
          ) : (
            <>Because of your {rationale.label}</>
          )}
        </p>
      ) : null}

      {directive ? (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {directive.items.map((item) => (
              <Popover key={item.term}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${item.term} — what this means`}
                    className={cn(
                      "atelier-focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-full border-[0.5px] border-border bg-background/60 py-1 pr-3 text-xs text-foreground/85 transition-colors hover:border-accent hover:text-foreground",
                      item.hex ? "pl-2" : "pl-3",
                    )}
                  >
                    {item.hex ? (
                      <span
                        aria-hidden="true"
                        className="size-3.5 shrink-0 rounded-full border-[0.5px] border-border"
                        style={{ backgroundColor: item.hex }}
                      />
                    ) : null}
                    {item.term}
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-64 rounded-card p-4">
                  <div className="flex items-center gap-3">
                    {item.hex ? (
                      <div
                        aria-hidden="true"
                        className="size-10 shrink-0 rounded-lg border-[0.5px] border-border"
                        style={{ backgroundColor: item.hex }}
                      />
                    ) : null}
                    <div className="min-w-0">
                      <p className="font-serif text-base leading-tight text-foreground">
                        {item.term}
                      </p>
                      {item.hex ? (
                        <p className="text-label uppercase tracking-label text-muted-foreground">
                          {item.hex}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-foreground/85">
                    {item.definition}
                  </p>
                </PopoverContent>
              </Popover>
            ))}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-foreground/85">{directive.note}</p>
        </>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">{fallback}</p>
      )}

      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="atelier-focus-ring mt-3 inline-flex min-h-9 items-center gap-1 rounded-control text-xs font-medium text-accent-ink hover:underline"
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
  /**
   * The avoid band carries the opposite instruction from every band above it,
   * and the swatches are the true colours either way — so the difference cannot
   * be left to hue. Each one gets a marker and the word.
   */
  tone = "wear",
}: {
  label: string;
  swatches: NamedSwatch[];
  tone?: "wear" | "avoid";
}) {
  if (swatches.length === 0) return null;
  const avoid = tone === "avoid";
  return (
    <div>
      <p className="mb-2 text-label uppercase tracking-label text-muted-foreground">{label}</p>
      {/* Fixed swatch size rather than a fractional grid: bands hold between two
          and four colours, and a 2-of-6 grid row reads as a mistake.
          No opacity — a swatch that renders at 80% is the wrong colour. */}
      <div className="flex flex-wrap gap-2">
        {swatches.map((s) => (
          <Popover key={s.hex + s.name}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`${avoid ? "Avoid" : "Wear"} ${s.name} — ${s.tip}`}
                className="atelier-focus-ring relative size-19 rounded-control border-[0.5px] border-border transition-colors hover:border-ink/50 sm:size-20"
                style={{ backgroundColor: s.hex }}
              >
                {avoid ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border-[0.5px] border-border bg-card text-destructive"
                  >
                    <X className="size-3" strokeWidth={3} />
                  </span>
                ) : null}
              </button>
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
                  <p className="text-label uppercase tracking-label text-muted-foreground">
                    {s.hex}
                  </p>
                </div>
              </div>
              {avoid ? (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-label font-semibold uppercase tracking-label text-destructive">
                  <X className="size-3" strokeWidth={3} aria-hidden="true" />
                  Avoid
                </p>
              ) : null}
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

/**
 * The page saves on a timer with no submit button, so this badge is the only
 * confirmation an edit landed. It stays visible on phones — the device it is
 * most often edited on — rather than hiding below `sm:`.
 */
export function SyncBadge({ status }: { status: "idle" | "syncing" | "synced" | "error" }) {
  const reduce = useReducedMotion();
  const label =
    status === "syncing"
      ? "Saving…"
      : status === "error"
        ? "Not saved"
        : status === "synced"
          ? "Saved"
          : "No changes";
  const dot =
    status === "syncing"
      ? "bg-warning animate-pulse"
      : status === "error"
        ? "bg-destructive"
        : status === "synced"
          ? "bg-success"
          : "bg-muted-foreground";
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-2 rounded-pill border-[0.5px] border-border bg-card px-3 py-1.5"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={status}
          initial={{ opacity: 0, scale: reduce ? 1 : 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: reduce ? 1 : 0.85 }}
          transition={{ duration: reduce ? 0 : 0.18, ease: [0.25, 1, 0.5, 1] }}
          className="flex items-center gap-2"
        >
          {/* Shape backs up the colour: the error state is the only one that is
              not a plain dot, so the status never rests on hue alone. */}
          {status === "error" ? (
            <X className="size-3 text-destructive" strokeWidth={3} aria-hidden="true" />
          ) : (
            <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
          )}
          <span className="text-label uppercase tracking-label text-muted-foreground">{label}</span>
        </motion.div>
      </AnimatePresence>
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
  const reduce = useReducedMotion();
  const opts: Array<{ id: "streamlined" | "detailed"; label: string }> = [
    { id: "streamlined", label: "Essentials" },
    { id: "detailed", label: "Every field" },
  ];
  return (
    <div
      role="tablist"
      aria-label="How much of the dossier to show"
      className="relative inline-flex rounded-pill border-[0.5px] border-border bg-card p-1"
    >
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className="atelier-focus-ring relative z-10 min-h-11 rounded-pill px-5 text-label uppercase tracking-label sm:px-7"
          >
            {active && (
              <motion.span
                layoutId="perspective-pill"
                className="absolute inset-0 rounded-pill bg-foreground"
                transition={reduce ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            <span className={`relative ${active ? "text-background" : "text-muted-foreground"}`}>
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
        {eyebrow && (
          <p className="text-label uppercase tracking-label text-muted-foreground">{eyebrow}</p>
        )}
        <h3 className="font-serif text-xl tracking-tight text-foreground">{title}</h3>
        {caption && (
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">{caption}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function DossierAccordion({
  value,
  title,
  caption,
  children,
  filled,
  total,
}: {
  value: string;
  title: string;
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
      className="rounded-card border-[0.5px] border-border bg-card px-5 sm:px-8"
    >
      <AccordionTrigger className="py-6 hover:no-underline">
        <div className="flex items-center justify-between w-full gap-3">
          <div className="flex flex-col items-start text-left gap-1">
            <h2 className="font-serif text-xl tracking-tight text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-md">{caption}</p>
          </div>
          {/* Both progress states carry a word or a count, so "done" is never
              read off the green alone. */}
          {complete && (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-success">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              <span className="text-label uppercase tracking-label">Complete</span>
            </span>
          )}
          {partial && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground shrink-0">
              <Circle className="size-4" aria-hidden="true" />
              <span className="text-label uppercase tracking-label">
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
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value === o;
        return (
          <motion.button
            key={o}
            type="button"
            onClick={() => onSelect(o)}
            whileTap={reduce ? undefined : { scale: 0.96 }}
            transition={{ duration: 0.1, ease: [0.25, 1, 0.5, 1] }}
            className={[
              "group inline-flex min-h-11 items-center gap-2 px-4 py-2.5 border transition-all duration-200",
              "text-label uppercase tracking-label-wide rounded-full",
              active
                ? "bg-accent-soft border-accent text-ink"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-accent/40",
            ].join(" ")}
          >
            <span>{o}</span>
          </motion.button>
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
      className="w-full rounded-xl overflow-hidden flex items-stretch border border-destructive/20 bg-destructive/10"
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
  const reduce = useReducedMotion();
  const full = limit != null && active.length >= limit;
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const isActive = active.includes(tag);
        const locked = full && !isActive;
        return (
          <motion.button
            key={tag}
            type="button"
            onClick={() => onToggle(tag)}
            disabled={locked}
            aria-pressed={isActive}
            whileTap={reduce || locked ? undefined : { scale: 0.96 }}
            transition={{ duration: 0.1, ease: [0.25, 1, 0.5, 1] }}
            className={[
              "inline-flex min-h-11 items-center gap-2 px-4 py-2.5 border rounded-full transition-all duration-200",
              "text-label uppercase tracking-label-wide",
              isActive
                ? "bg-accent-soft border-accent text-ink"
                : locked
                  ? "bg-card border-border text-muted-foreground/40 cursor-not-allowed"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-accent/40",
            ].join(" ")}
          >
            {isActive ? (
              <motion.span
                initial={reduce ? false : { scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: reduce ? 0 : 0.18, ease: [0.25, 1, 0.5, 1] }}
                className="flex"
              >
                <Check className="size-3.5" aria-hidden="true" />
              </motion.span>
            ) : null}
            <span>{tag}</span>
          </motion.button>
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
        <p className="text-label uppercase tracking-label text-accent-ink whitespace-nowrap">
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
