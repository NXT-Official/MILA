import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  kicker,
  title,
  description,
  align = "left",
  size = "default",
  className,
}: {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "center";
  /** `compact` keeps the display face but steps the masthead back, for pages
   *  whose content — photography, a feed — should out-weigh the page title. */
  size?: "default" | "compact";
  className?: string;
}) {
  const centered = align === "center";
  return (
    <header className={cn("mb-10 sm:mb-14", centered && "text-center", className)}>
      {/* Not `.atelier-kicker` — DESIGN.md retired it. Same label treatment the
          rest of the system uses, spelled in tokens. */}
      {kicker ? (
        <p className="mb-3 text-label font-semibold uppercase tracking-label text-muted-foreground">
          {kicker}
        </p>
      ) : null}
      <h1
        className={cn(
          size === "compact"
            ? "font-display text-3xl font-bold tracking-tight md:text-4xl"
            : "atelier-title",
        )}
      >
        {title}
      </h1>
      {description ? (
        <p
          className={cn(
            "mt-4 max-w-reading text-base leading-relaxed text-pretty text-muted-foreground",
            centered && "mx-auto",
          )}
        >
          {description}
        </p>
      ) : null}
    </header>
  );
}
