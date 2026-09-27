import type { LucideIcon } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { cn } from "@/lib/utils";

export function Section({
  id,
  className,
  children,
  stagger,
  "aria-label": ariaLabel,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
  stagger?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Reveal
      id={id}
      aria-label={ariaLabel}
      stagger={stagger}
      className="scroll-mt-16 border-t border-border"
    >
      <div className={cn("atelier-container py-20 sm:py-24", className)}>{children}</div>
    </Reveal>
  );
}

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

export function IconTile({
  icon: Icon,
  size = "md",
  className,
}: {
  icon: LucideIcon;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-panel border border-border bg-accent-soft/50 text-ink",
        size === "sm" ? "size-9" : "size-11",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-4" : "size-5"} strokeWidth={1.75} aria-hidden="true" />
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
