import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  kicker,
  title,
  description,
  align = "left",
  className,
}: {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  const centered = align === "center";
  return (
    <header className={cn("mb-10 sm:mb-14", centered && "text-center", className)}>
      {kicker ? <p className="atelier-kicker mb-3">{kicker}</p> : null}
      <h1 className="atelier-title">{title}</h1>
      {description ? (
        <p className={cn("mt-4 max-w-xl text-muted", centered && "mx-auto")}>{description}</p>
      ) : null}
    </header>
  );
}
