import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div className={cn("max-w-reading", className)} {...props}>
      {eyebrow ? <p className="mila-eyebrow mb-2">{eyebrow}</p> : null}
      <h2 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {title}
      </h2>
      {description ? <p className="mt-3 text-base text-muted">{description}</p> : null}
    </div>
  );
}
