import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Section rhythm is deliberate, not uniform: the quick sequences breathe less
// than the two artifact sections, and the emotional close breathes most. All
// three sit higher than before — with the boxes gone, space is the only thing
// separating one section from the next, so it has to do that work.
const SPACING = {
  tight: "py-20 sm:py-28",
  default: "py-24 sm:py-32",
  generous: "py-28 sm:py-40",
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
    // A flat wash, not a solid ground — the reel still reads through it. Flat
    // and not a gradient: a graded scrim drops its last line onto raw video on
    // tall phone layouts. `--page-wash` is shared with the hero's bottom fade,
    // so the two meet on the same value instead of on a seam.
    <section id={id} aria-label={ariaLabel} className="atelier-ground scroll-mt-24">
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
    // The measure is set in `ch`, not `rem`: it caps the line at a character
    // count whatever the clamp resolves the type size to, which is what actually
    // governs whether a paragraph is comfortable to read. It's measured at the
    // wrapper's font size, so the h2 — ~2.5x that — gets far fewer characters
    // per line than the number suggests; the centred cap has to leave the
    // heading room for two lines, not four.
    <div className={cn(centered ? "mx-auto max-w-[80ch] text-center" : "max-w-[46ch]", className)}>
      <h2 className="text-[clamp(1.875rem,3.2vw,2.5rem)] leading-[1.08] tracking-[-0.02em] text-balance">
        {heading}
      </h2>
      {body ? (
        <p className="mt-6 text-base leading-[1.75] text-pretty text-muted-foreground sm:text-lg">
          {body}
        </p>
      ) : null}
    </div>
  );
}
