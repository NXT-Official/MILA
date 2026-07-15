import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { profileQueryOptions } from "@/lib/queries/profile";
import { isStyleProfileComplete } from "@/lib/style-profile/completion";
import { normalizeStoredProfile } from "@/lib/style-profile/studio-dossier";
import { type StudioColorProfile } from "@/lib/analyzePersonalColor.functions";
import {
  type StudioTelemetry,
  type DetailedColorProfile as StudioDossier,
} from "@/constants/style-profile";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  getFirstIncompleteOnboardingStep,
  isOnboardingStepReachable,
  type OnboardingStepId,
} from "../../constants/steps";
import { OnboardingProgressBar } from "./progress-bar";
import { WelcomeStep } from "./steps/welcome-step";
import { ColorPathStep } from "./steps/color-path-step";
import { ColorResultStep } from "./steps/color-result-step";
import { BodyTypeStep } from "./steps/body-type-step";
import { FaceShapeStep } from "./steps/face-shape-step";
import { HairTypeStep } from "./steps/hair-type-step";
import { BeautyPreferencesStep } from "./steps/beauty-preferences-step";
import { LocationStep } from "./steps/location-step";
import { ReviewStep } from "./steps/review-step";

export function StyleProfileOnboarding({
  step,
  onStepChange,
}: {
  step: OnboardingStepId | undefined;
  onStepChange: (step: OnboardingStepId, opts?: { replace?: boolean }) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const profileQuery = useQuery({ ...profileQueryOptions(user?.id), enabled: !!user });
  const profile = profileQuery.data;

  const [pendingCandidate, setPendingCandidate] = useState<StudioColorProfile | null>(null);
  const [pendingTelemetry, setPendingTelemetry] = useState<StudioTelemetry | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);

  const didResolveInitialStepRef = useRef(false);
  useEffect(() => {
    if (!profile || didResolveInitialStepRef.current) return;
    didResolveInitialStepRef.current = true;
    if (!step || !isOnboardingStepReachable(step, profile)) {
      onStepChange(getFirstIncompleteOnboardingStep(profile), { replace: true });
    }
  }, [profile, step]);

  useEffect(() => {
    if (!step) return;
    document.getElementById("onboarding-step-heading")?.focus();
  }, [step]);

  if (!user || profileQuery.isLoading || !step) {
    return <LoadingState label="Loading your profile…" className="py-24" />;
  }

  if (profileQuery.isError) {
    return (
      <ErrorState
        title="We couldn't load your profile"
        description="Please try again."
        action={{ label: "Retry", onClick: () => profileQuery.refetch() }}
      />
    );
  }

  const dossier: StudioDossier | null = normalizeStoredProfile(profile?.color_profile);
  const beautyPrefs = Array.isArray(profile?.beauty_preferences)
    ? (profile!.beauty_preferences as unknown[]).filter((t): t is string => typeof t === "string")
    : [];

  function goTo(next: OnboardingStepId) {
    onStepChange(next);
  }

  async function handleComplete() {
    if (!user) return;
    setCompleting(true);
    setCompletionError(null);
    try {
      const options = profileQueryOptions(user.id);
      await queryClient.invalidateQueries({ queryKey: options.queryKey });
      const fresh = queryClient.getQueryData(options.queryKey) ?? profile;
      const complete = isStyleProfileComplete({
        skin_undertone: fresh?.skin_undertone ?? null,
        color_season: fresh?.color_season_base ?? null,
        body_type: fresh?.body_type ?? null,
        face_shape: fresh?.face_shape ?? null,
        hair_type: fresh?.hair_type ?? null,
        color_profile: fresh?.color_profile ?? null,
      });
      if (!complete) {
        const firstIncomplete = getFirstIncompleteOnboardingStep(fresh);
        setCompletionError(
          "A few required steps still need your input — taking you back to finish them.",
        );
        goTo(firstIncomplete === "welcome" ? "color-path" : firstIncomplete);
        return;
      }
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      setCompletionError(
        err instanceof Error ? err.message : "We couldn't confirm your profile. Please try again.",
      );
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-6 sm:py-10">
      {step !== "welcome" ? <OnboardingProgressBar current={step} /> : null}

      {step === "welcome" && <WelcomeStep onBegin={() => goTo("color-path")} />}

      {step === "color-path" && (
        <ColorPathStep
          existingDossier={dossier}
          onCandidateReady={(candidate, telemetry) => {
            setPendingCandidate(candidate);
            setPendingTelemetry(telemetry ?? null);
            goTo("color-result");
          }}
          onContinueExisting={() => {
            setPendingCandidate(null);
            goTo("color-result");
          }}
        />
      )}

      {step === "color-result" && (
        <ColorResultStep
          candidate={pendingCandidate}
          telemetry={pendingTelemetry}
          existingDossier={dossier}
          fullName={profile?.full_name ?? null}
          onBack={() => goTo("color-path")}
          onReviewAnother={() => {
            setPendingCandidate(null);
            goTo("color-path");
          }}
          onConfirmed={() => {
            setPendingCandidate(null);
            goTo("body-type");
          }}
        />
      )}

      {step === "body-type" && (
        <BodyTypeStep
          value={profile?.body_type ?? null}
          onBack={() => goTo("color-result")}
          onSaved={() => goTo("face-shape")}
        />
      )}

      {step === "face-shape" && (
        <FaceShapeStep
          value={profile?.face_shape ?? null}
          onBack={() => goTo("body-type")}
          onSaved={() => goTo("hair-type")}
        />
      )}

      {step === "hair-type" && (
        <HairTypeStep
          value={profile?.hair_type ?? null}
          onBack={() => goTo("face-shape")}
          onSaved={() => goTo("beauty-preferences")}
        />
      )}

      {step === "beauty-preferences" && (
        <BeautyPreferencesStep
          value={beautyPrefs}
          onBack={() => goTo("hair-type")}
          onSaved={() => goTo("location")}
        />
      )}

      {step === "location" && (
        <LocationStep
          value={profile?.default_location ?? null}
          onBack={() => goTo("beauty-preferences")}
          onSaved={() => goTo("review")}
        />
      )}

      {step === "review" && profile && (
        <ReviewStep
          profile={profile}
          dossier={dossier}
          onEdit={(s) => goTo(s)}
          onComplete={handleComplete}
          completing={completing}
          completionError={completionError}
        />
      )}
    </div>
  );
}
