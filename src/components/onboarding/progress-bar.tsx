import { cn } from "@/lib/utils";
import {
  COUNTED_STEPS,
  getOnboardingStepIndex,
  type OnboardingStepId,
} from "../../constants/steps";

export function OnboardingProgressBar({ current }: { current: OnboardingStepId }) {
  const index = getOnboardingStepIndex(current);
  const step = COUNTED_STEPS[index];
  const total = COUNTED_STEPS.length;
  if (index === -1 || !step) return null;

  return (
    <div className="mb-8">
      <p className="text-xs uppercase tracking-[0.16em] text-accent font-semibold">
        Step {index + 1} of {total}
        {step.optional ? (
          <span className="text-muted normal-case tracking-normal"> · Optional</span>
        ) : null}
      </p>
      <h2
        id="onboarding-step-heading"
        tabIndex={-1}
        className="mt-1 font-display text-2xl font-semibold text-ink outline-none"
      >
        {step.title}
      </h2>
      {step.description ? (
        <p className="mt-1 text-sm text-muted max-w-reading">{step.description}</p>
      ) : null}

      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={index + 1}
        aria-valuetext={`Step ${index + 1} of ${total}: ${step.title}`}
        className="mt-4 flex gap-1.5"
      >
        {COUNTED_STEPS.map((s, i) => (
          <span
            key={s.id}
            aria-hidden="true"
            className={cn(
              "h-1.5 flex-1 rounded-pill bg-line transition-colors duration-300 ease-editorial",
              i < index && "bg-accent",
              i === index && "bg-ink",
            )}
          />
        ))}
      </div>
      <span className="sr-only" role="status">
        Step {index + 1} of {total}: {step.title}
        {step.optional ? ", optional" : ""}
      </span>
    </div>
  );
}
