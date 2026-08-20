import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Section rhythm is deliberate, not uniform: the quick sequences breathe less
// than the two artifact sections, and the emotional close breathes most.
const SPACING = {
  tight: "py-16 sm:py-20",
  default: "py-20 sm:py-24",
  generous: "py-24 sm:py-32 lg:py-36",
} as const;

export function Section({
  id,
  className,
  children,
  spacing = "default",
  "aria-label": ariaLabel,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
  spacing?: keyof typeof SPACING;
  "aria-label"?: string;
}) {
  return (
    <section id={id} aria-label={ariaLabel} className="scroll-mt-16 border-t border-border">
      <div className={cn("atelier-container", SPACING[spacing], className)}>{children}</div>
    </section>
  );
}

/**
 * A label *inside* an artifact — a dossier row, a hero facet, a price tag.
 * Never a section eyebrow: see DESIGN.md, `.atelier-kicker` is deprecated.
 */
export function Eyebrow({
  children,
  icon: Icon,
  className,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-label font-semibold uppercase tracking-label text-muted-foreground",
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" /> : null}
      {children}
    </p>
  );
}

export function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-panel border border-border bg-accent-soft/50 text-ink",
        className,
      )}
    >
      <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

export function SectionHeading({
  heading,
  body,
  align = "left",
  className,
}: {
  heading: string;
  body?: string;
  align?: "left" | "center";
  className?: string;
}) {
  const centered = align === "center";
  return (
    <div className={cn("max-w-xl", centered && "mx-auto text-center", className)}>
      <h2 className="text-[clamp(2rem,4vw,3rem)] leading-[1.05]">{heading}</h2>
      {body ? (
        <p className="mt-6 text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
          {body}
        </p>
      ) : null}
    </div>
  );
}
