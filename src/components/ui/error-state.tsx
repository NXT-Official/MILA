import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export function LoadErrorPanel({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Card role="alert" className="mx-auto max-w-xl p-10 text-center sm:p-14">
      <p className="mb-2 font-serif text-2xl text-ink">{title}</p>
      <p className="text-sm text-muted">
        Something went wrong on our side. Please try again in a moment.
      </p>
      <Button variant="secondary" className="mt-6" onClick={onRetry}>
        Try Again
      </Button>
    </Card>
  );
}

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
