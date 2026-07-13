import { useState } from "react";
import { Check } from "lucide-react";
import { BEAUTY_PREFERENCE_TAGS } from "@/constants/style-profile";
import { StepFooter } from "@/components/onboarding/step-shell";
import { useUpdateStyleProfile } from "@/lib/queries/profile-mutations";
import type { Json } from "@/integrations/supabase/types";

export function BeautyPreferencesStep({
  value,
  onBack,
  onSaved,
}: {
  value: string[];
  onBack: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(value);
  const [error, setError] = useState<string | null>(null);
  const mutation = useUpdateStyleProfile();

  function toggle(tag: string) {
    setSelected((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  async function handleContinue() {
    setError(null);
    try {
      await mutation.mutateAsync({ beauty_preferences: selected as unknown as Json });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save this step.");
    }
  }

  return (
    <div>
      <p className="mb-6 max-w-reading text-sm text-muted leading-relaxed">
        Select the types of recommendations you want Mila to prioritize in makeup and beauty
        suggestions. This step is optional — leave everything unselected for no preference.
      </p>
      <div role="group" aria-label="Beauty preferences" className="flex flex-wrap gap-2">
        {BEAUTY_PREFERENCE_TAGS.map((tag) => {
          const active = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(tag)}
              className={`mila-focus-ring inline-flex items-center gap-1.5 rounded-pill border px-4 py-2.5 text-xs font-medium transition-colors ${
                active
                  ? "border-ink bg-accent-soft text-ink"
                  : "border-line text-muted hover:border-accent hover:text-ink"
              }`}
            >
              {active && <Check className="size-3" aria-hidden="true" />}
              {tag}
            </button>
          );
        })}
      </div>
      {selected.length === 0 ? (
        <p className="mt-3 text-xs text-muted">
          No beauty preferences selected — Mila will style you without a bias, and you can add
          preferences any time from Style Profile.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          We couldn't save this step. Your selections are still here — try again when you're ready.
        </p>
      ) : null}
      <StepFooter
        onBack={onBack}
        continueLabel={selected.length === 0 ? "Continue without preferences" : "Continue"}
        continueLoading={mutation.isPending}
        onContinue={handleContinue}
        saveStatus={mutation.isPending ? "saving" : error ? "error" : "idle"}
        onRetrySave={handleContinue}
      />
    </div>
  );
}
