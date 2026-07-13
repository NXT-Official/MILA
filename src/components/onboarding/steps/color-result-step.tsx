import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { type StudioColorProfile } from "@/lib/analyzePersonalColor.functions";
import {
  type DetailedColorProfile as StudioDossier,
  type StudioTelemetry,
} from "@/constants/style-profile";
import { studioToDossier } from "@/lib/style-profile/studio-dossier";
import { ColorDossierSection } from "@/components/studio/style-profile";
import { StudioPortfolioView } from "@/components/style-profile/studio-portfolio-view";
import { StepFooter } from "@/components/onboarding/step-shell";
import { useUpdateStyleProfile } from "@/lib/queries/profile-mutations";
import type { Json } from "@/integrations/supabase/types";

export function ColorResultStep({
  candidate,
  telemetry,
  existingDossier,
  fullName,
  onBack,
  onReviewAnother,
  onConfirmed,
}: {
  candidate: StudioColorProfile | null;
  telemetry?: StudioTelemetry | null;
  existingDossier: StudioDossier | null;
  fullName: string | null;
  onBack: () => void;
  onReviewAnother: () => void;
  onConfirmed: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useUpdateStyleProfile();

  const dossier = useMemo<StudioDossier | null>(() => {
    if (candidate) return studioToDossier(candidate, existingDossier ?? undefined);
    return existingDossier;
  }, [candidate, existingDossier]);

  if (!dossier) {
    return (
      <EmptyState
        icon={<Sparkles className="size-6" aria-hidden="true" />}
        title="No color result yet"
        description="Choose a known season or analyze your coloring to continue."
        action={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
      />
    );
  }

  async function handleConfirm() {
    if (!dossier) return;
    setError(null);
    const undertone = (["Spring", "Autumn"] as string[]).includes(dossier.season) ? "Warm" : "Cool";
    try {
      await mutation.mutateAsync({
        skin_undertone: undertone,
        color_season: dossier.season,
        color_profile: dossier as unknown as Json,
      });
      onConfirmed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save this step.");
    }
  }

  return (
    <div>
      <p className="max-w-reading text-sm text-muted leading-relaxed">
        This is what Mila will use to color your recommendations — palette, undertone, and the
        colors to soften or avoid.
      </p>
      <div className="mt-6">
        <ColorDossierSection
          profile={{ color_season: dossier.season, full_name: fullName ?? undefined }}
        />
      </div>
      <div className="mt-6">
        <StudioPortfolioView profile={dossier} isDemo={false} telemetry={telemetry ?? null} />
      </div>

      <StepFooter
        onBack={onBack}
        continueLabel="Use this profile"
        continueLoading={mutation.isPending}
        onContinue={handleConfirm}
        saveStatus={mutation.isPending ? "saving" : error ? "error" : "idle"}
        onRetrySave={handleConfirm}
      />
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          We couldn't save this step. Your selection is still here — try again when you're ready.
        </p>
      ) : null}
      <button
        type="button"
        onClick={onReviewAnother}
        className="mila-focus-ring mt-4 block text-xs text-accent hover:underline"
      >
        Review another result
      </button>
    </div>
  );
}
