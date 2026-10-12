import { Check, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepFooter } from "../step-shell";

/**
 * The fork after the seventh question.
 *
 * Everything Mila needs to style someone is already saved by the time this
 * screen renders — the seven answers below are the whole required profile. The
 * rest of the wizard (measurements, makeup, beauty, location, shopping,
 * constraints) only runs if she takes the second button, which is the point:
 * a registration that asks fifteen questions up front reads as a form, and
 * most people stop answering.
 */
const ANSWERED = [
  "Your coloring",
  "Your gender",
  "Skin depth",
  "Body silhouette",
  "Face shape",
  "Hair type",
  "Hair length",
];

export function RefineStep({
  onBack,
  onFinish,
  onAddDetail,
}: {
  onBack: () => void;
  onFinish: () => void;
  onAddDetail: () => void;
}) {
  return (
    <div>
      <div className="flex items-start gap-3 rounded-card border border-line bg-accent-soft/40 p-5">
        <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-ink">
            That&apos;s the seven answers Mila needs — your profile is ready.
          </p>
          <p className="mt-1 text-xs text-muted leading-relaxed">
            Mila can already style your daily looks from this. The questions after this point are
            optional: answer them only if you want more precise recommendations.
          </p>
        </div>
      </div>

      <ul className="mt-6 grid gap-2 sm:grid-cols-2">
        {ANSWERED.map((item) => (
          <li key={item} className="flex items-center gap-2 text-sm text-ink">
            <Check className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>

      <div className="mt-8 rounded-card border border-line bg-surface p-4">
        <p className="text-sm font-medium text-ink">Want sharper looks?</p>
        <p className="mt-1 text-xs text-muted leading-relaxed">
          A few optional extras — measurements, makeup preference, beauty priorities, your location
          and shopping preferences — let Mila adapt fit, color, and weather to you. You can also add
          them later from Style Profile.
        </p>
        <Button className="mt-4" variant="outline" onClick={onAddDetail}>
          <ListChecks className="size-4" aria-hidden="true" />
          Add more detail (optional)
        </Button>
      </div>

      <StepFooter onBack={onBack} onContinue={onFinish} continueLabel="Save & continue" />

      <p className="mt-4 text-center text-xs text-muted">
        Nothing is lost either way — your answers save as you go.
      </p>
    </div>
  );
}
