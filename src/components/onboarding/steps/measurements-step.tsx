import { useState } from "react";
import { StepFooter } from "@/components/onboarding/step-shell";
import { useUpdateStyleProfile } from "@/lib/queries/profile-mutations";
import { errorMessage } from "@/lib/utils";

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

/**
 * Optional height/weight capture. Stored normalized in metric (height_cm,
 * weight_kg) regardless of the unit toggle. These feed the outfit prompt as
 * light styling language (e.g. petite/tall framing) — there's no garment
 * size dataset to do real numeric size-matching against.
 */
export function MeasurementsStep({
  heightCm,
  weightKg,
  onBack,
  onSaved,
}: {
  heightCm: number | null;
  weightKg: number | null;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [unit, setUnit] = useState<"metric" | "imperial">("metric");
  const [height, setHeight] = useState(
    heightCm == null
      ? ""
      : unit === "metric"
        ? String(heightCm)
        : String(Math.round(heightCm / CM_PER_IN)),
  );
  const [weight, setWeight] = useState(
    weightKg == null
      ? ""
      : unit === "metric"
        ? String(weightKg)
        : String(Math.round(weightKg / KG_PER_LB)),
  );
  const [error, setError] = useState<string | null>(null);
  const mutation = useUpdateStyleProfile();

  function switchUnit(next: "metric" | "imperial") {
    if (next === unit) return;
    const h = Number(height);
    const w = Number(weight);
    if (height && Number.isFinite(h)) {
      setHeight(
        next === "imperial" ? String(Math.round(h / CM_PER_IN)) : String(Math.round(h * CM_PER_IN)),
      );
    }
    if (weight && Number.isFinite(w)) {
      setWeight(
        next === "imperial" ? String(Math.round(w / KG_PER_LB)) : String(Math.round(w * KG_PER_LB)),
      );
    }
    setUnit(next);
  }

  async function handleContinue() {
    setError(null);
    const h = height.trim() ? Number(height) : null;
    const w = weight.trim() ? Number(weight) : null;
    if ((h != null && !Number.isFinite(h)) || (w != null && !Number.isFinite(w))) {
      setError("Enter numbers only, or leave blank to skip.");
      return;
    }
    const height_cm = h == null ? null : Math.round(unit === "imperial" ? h * CM_PER_IN : h);
    const weight_kg = w == null ? null : Math.round(unit === "imperial" ? w * KG_PER_LB : w);
    if (height_cm != null && (height_cm < 100 || height_cm > 250)) {
      setError("Height looks out of range — double-check the unit or the value.");
      return;
    }
    if (weight_kg != null && (weight_kg < 30 || weight_kg > 250)) {
      setError("Weight looks out of range — double-check the unit or the value.");
      return;
    }
    try {
      await mutation.mutateAsync({ height_cm, weight_kg });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "We couldn't save this step."));
    }
  }

  return (
    <div>
      <p className="mb-6 max-w-reading text-sm text-muted leading-relaxed">
        Optional. This helps Mila describe fit and proportion in your looks — it doesn't match exact
        garment sizes, since that data isn't available per brand.
      </p>
      <div
        role="group"
        aria-label="Units"
        className="mb-4 inline-flex rounded-pill border border-line p-1"
      >
        {(["metric", "imperial"] as const).map((u) => (
          <button
            key={u}
            type="button"
            aria-pressed={unit === u}
            onClick={() => switchUnit(u)}
            className={`atelier-focus-ring rounded-pill px-3 py-1.5 text-xs font-medium transition-colors ${
              unit === u ? "bg-accent-soft text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {u === "metric" ? "cm / kg" : "in / lb"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">
            Height ({unit === "metric" ? "cm" : "in"})
          </span>
          <input
            type="number"
            inputMode="numeric"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            className="atelier-focus-ring w-full rounded-md border border-line bg-transparent px-3 py-2.5 text-sm"
            placeholder={unit === "metric" ? "165" : "65"}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">
            Weight ({unit === "metric" ? "kg" : "lb"})
          </span>
          <input
            type="number"
            inputMode="numeric"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="atelier-focus-ring w-full rounded-md border border-line bg-transparent px-3 py-2.5 text-sm"
            placeholder={unit === "metric" ? "60" : "132"}
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <StepFooter
        onBack={onBack}
        continueLabel={height.trim() || weight.trim() ? "Continue" : "Skip"}
        continueLoading={mutation.isPending}
        onContinue={handleContinue}
        saveStatus={mutation.isPending ? "saving" : error ? "error" : "idle"}
        onRetrySave={handleContinue}
      />
    </div>
  );
}
