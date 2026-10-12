import { cn } from "@/lib/utils";
import {
  CORE_QUESTION_COUNT,
  CORE_QUESTION_STEPS,
  COUNTED_STEPS,
  getCoreQuestionNumber,
  getOnboardingStepIndex,
  type OnboardingStepId,
} from "../../constants/steps";

/**
 * Two readings, on purpose.
 *
 * Through the required questions it counts questions — "Question 3 of 7" — so
 * the end is always in sight, and the two colour screens count as one question
 * because they are one answer.
 *
 * From the fork onwards the count is finished and the bar says so: the steps
 * left are optional extras she opted into, not a numbered queue. Showing
 * "Step 9 of 16" there is what made registration feel bottomless.
 */
export function OnboardingProgressBar({ current }: { current: OnboardingStepId }) {
  const index = getOnboardingStepIndex(current);
  const step = COUNTED_STEPS[index];
  if (index === -1 || !step) return null;

  const question = getCoreQuestionNumber(current);
  const filled = question ?? CORE_QUESTION_COUNT;
  const label =
    question !== null
      ? `Question ${question} of ${CORE_QUESTION_COUNT}`
      : step.optional
        ? "Optional extras"
        : "All seven questions answered";

  return (
    <div className="mb-8">
      <p className="text-xs uppercase tracking-label-tight text-accent font-semibold">
        {label}
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
        aria-valuemax={CORE_QUESTION_COUNT}
        aria-valuenow={filled}
        aria-valuetext={`${label}: ${step.title}`}
        className="mt-4 flex gap-1.5"
      >
        {CORE_QUESTION_STEPS.map((id, i) => (
          <span
            key={id}
            aria-hidden="true"
            className={cn(
              "h-1.5 flex-1 rounded-pill bg-line transition-colors duration-300 ease-editorial",
              i < filled - 1 && "bg-accent",
              i === filled - 1 && "bg-ink",
            )}
          />
        ))}
      </div>
      <span className="sr-only" role="status">
        {label}: {step.title}
        {step.optional ? ", optional" : ""}
      </span>
    </div>
  );
}
