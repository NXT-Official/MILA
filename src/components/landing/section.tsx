import type { LucideIcon } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { cn } from "@/lib/utils";

export function Section({
  id,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
}) {
  return (
    <Reveal id={id} aria-label={ariaLabel} className="scroll-mt-16 border-t border-border">
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
  kicker,
  heading,
  body,
  align = "left",
  className,
}: {
  kicker?: string;
  heading: string;
  body?: string;
  align?: "left" | "center";
  className?: string;
}) {
  const centered = align === "center";
  return (
    <div className={cn("max-w-xl", centered && "mx-auto text-center", className)}>
      {kicker ? (
        <Eyebrow className={centered ? "justify-center" : undefined}>{kicker}</Eyebrow>
      ) : null}
      <h2 className="mt-4 text-[clamp(2rem,4vw,3rem)] leading-[1.05]">{heading}</h2>
      {body ? (
        <p className="mt-6 text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
          {body}
        </p>
      ) : null}
    </div>
  );
}
