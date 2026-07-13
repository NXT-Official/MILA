import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; href: string };
  className?: string;
}

export function ErrorState({
  title,
  description,
  action,
  secondaryAction,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn("flex min-h-screen items-center justify-center bg-canvas px-4", className)}>
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-2 text-sm text-muted">{description}</p> : null}
        {action || secondaryAction ? (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {action ? <Button onClick={action.onClick}>{action.label}</Button> : null}
            {secondaryAction ? (
              <Button asChild variant="outline">
                <a href={secondaryAction.href}>{secondaryAction.label}</a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
