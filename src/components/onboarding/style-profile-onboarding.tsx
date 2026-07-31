import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { profileQueryOptions } from "@/lib/queries/profile";
import { isStyleProfileComplete, toStyleProfileRow } from "@/lib/style-profile/completion";
import { normalizeStoredProfile } from "@/lib/style-profile/studio-dossier";
import { type StudioColorProfile } from "@/lib/analyzePersonalColor.functions";
import {
  BODY_OPTIONS,
  FACE_SHAPE_OPTIONS,
  HAIR_TYPE_OPTIONS,
  type MatrixOption,
  type StudioTelemetry,
  type DetailedColorProfile as StudioDossier,
} from "@/constants/style-profile";
import { useUpdateStyleProfile } from "@/lib/queries/profile-mutations";
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
import { SingleSelectStep } from "./steps/single-select-step";
import { BeautyPreferencesStep } from "./steps/beauty-preferences-step";
import { LocationStep } from "./steps/location-step";
import { ReviewStep } from "./steps/review-step";
import { errorMessage } from "@/lib/utils";

const SELECT_STEPS = {
  "body-type": {
    field: "body_type",
    fieldLabel: "Your silhouette",
    options: BODY_OPTIONS,
    guidance:
      "Choose the shape that most closely describes how your shoulders, waist, and hips relate to one another. This drives every cut, drape, and proportion recommendation — there's no wrong answer.",
    requiredMessage: "Select a body silhouette to continue.",
    back: "color-result",
    next: "face-shape",
  },
  "face-shape": {
    field: "face_shape",
    fieldLabel: "Your face shape",
    options: FACE_SHAPE_OPTIONS,
    guidance:
      "Pick whichever shape reads closest — Mila uses this to guide hairstyling, eyewear, and framing suggestions. You can always refine it later.",
    requiredMessage: "Select a face shape to continue.",
    back: "body-type",
    next: "hair-type",
  },
  "hair-type": {
    field: "hair_type",
    fieldLabel: "Your hair type",
    options: HAIR_TYPE_OPTIONS,
    guidance:
      "This shapes the silhouette of every hair direction Mila composes, from styling to product suggestions.",
    requiredMessage: "Select a hair type to continue.",
    back: "face-shape",
    next: "beauty-preferences",
  },
} as const satisfies Record<
  string,
  {
    field: "body_type" | "face_shape" | "hair_type";
    fieldLabel: string;
    options: MatrixOption[];
    guidance: string;
    requiredMessage: string;
    back: OnboardingStepId;
    next: OnboardingStepId;
  }
>;

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
  const updateProfile = useUpdateStyleProfile();
  const selectStep = step ? SELECT_STEPS[step as keyof typeof SELECT_STEPS] : undefined;

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
  }, [profile, step, onStepChange]);

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
      const complete = isStyleProfileComplete(toStyleProfileRow(fresh));
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
      setCompletionError(errorMessage(err, "We couldn't confirm your profile. Please try again."));
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

      {selectStep && (
        <SingleSelectStep
          key={step}
          fieldLabel={selectStep.fieldLabel}
          value={profile?.[selectStep.field] ?? null}
          options={selectStep.options}
          guidance={selectStep.guidance}
          requiredMessage={selectStep.requiredMessage}
          onBack={() => goTo(selectStep.back)}
          onSaved={() => goTo(selectStep.next)}
          save={async (value) => {
            await updateProfile.mutateAsync({ [selectStep.field]: value });
          }}
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
