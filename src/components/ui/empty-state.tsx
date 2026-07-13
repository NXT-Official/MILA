import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "mila-panel flex flex-col items-center gap-3 px-6 py-14 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="text-accent" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="font-display text-xl font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-reading text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
