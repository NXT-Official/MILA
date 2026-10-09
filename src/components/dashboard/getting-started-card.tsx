import { useEffect, useState } from "react";
import { CheckCircle2, Circle, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import {
  gettingStartedProgress,
  gettingStartedSteps,
  nextGettingStartedStep,
  readGettingStartedDismissed,
  writeGettingStartedDismissed,
  type GettingStartedInput,
} from "./getting-started";

/**
 * The first thing a new member sees on the dashboard: three numbered moves,
 * each with the button that starts it. Dismissing it, or finishing all three,
 * takes it off the page for good.
 */
export function GettingStartedCard(props: GettingStartedInput) {
  // Read the stored dismissal after mount: this renders on the server too, and
  // localStorage does not exist there.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(readGettingStartedDismissed());
  }, []);

  const steps = gettingStartedSteps(props);
  const progress = gettingStartedProgress(steps);
  const next = nextGettingStartedStep(steps);

  if (progress.allDone || dismissed) return null;

  return (
    <Card role="region" aria-label="Getting started" className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-line/70 px-5 py-4">
        <div className="min-w-0">
          <p className="text-nano uppercase tracking-label text-muted-foreground">
            Getting started
          </p>
          <h2 className="mt-0.5 font-serif text-lg text-ink">Three things to do first</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {progress.done} of {progress.total} done — the rest of Mila opens up once these are in.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss getting started"
          onClick={() => {
            writeGettingStartedDismissed();
            setDismissed(true);
          }}
          className="atelier-focus-ring -mr-1 -mt-1 shrink-0 rounded-control p-1.5 text-muted-foreground transition-colors hover:bg-accent-soft/50 hover:text-ink"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="h-1 w-full bg-accent-soft/50" aria-hidden="true">
        <div
          className="h-full bg-accent transition-[width] duration-500 ease-editorial"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <ol className="divide-y divide-line/60">
        {steps.map((step, index) => {
          const isNext = next?.id === step.id;
          return (
            <li
              key={step.id}
              className={cn(
                "flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4",
                step.done && "opacity-55",
              )}
            >
              <span className="flex items-center gap-3 sm:w-8">
                {step.done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-accent" aria-hidden="true" />
                ) : (
                  <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="text-nano uppercase tracking-label text-muted-foreground sm:hidden">
                  Step {index + 1}
                </span>
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {step.title}
                  {step.done ? (
                    <span className="text-micro font-normal uppercase tracking-label-wide text-accent">
                      Done
                    </span>
                  ) : isNext ? (
                    <span className="rounded-full bg-accent-soft/70 px-2 py-0.5 text-micro uppercase tracking-label-wide text-accent">
                      Start here
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{step.hint}</p>
              </div>

              {!step.done && (
                <a
                  href={step.href}
                  className={cn(
                    buttonVariants({ variant: isNext ? "primary" : "outline", size: "sm" }),
                    "shrink-0 self-start sm:self-auto",
                  )}
                >
                  {step.cta}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
