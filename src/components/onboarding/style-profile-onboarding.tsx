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
  GENDER_OPTIONS,
  HAIR_LENGTH_OPTIONS,
  MAKEUP_PREFERENCE_OPTIONS,
  SKIN_DEPTH_OPTIONS,
  SHOPPING_PREFERENCE_TAGS,
  STYLING_CONSTRAINT_TAGS,
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
import { TagSelectStep } from "./steps/tag-select-step";
import { MeasurementsStep } from "./steps/measurements-step";
import { LocationStep } from "./steps/location-step";
import { ReviewStep } from "./steps/review-step";
import { errorMessage } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/track-event";

const MAKEUP_ELIGIBLE_NEXT = "makeup-preference" as const;
const MAKEUP_SKIP_NEXT = "beauty-preferences" as const;

const SELECT_STEPS = {
  gender: {
    field: "gender",
    fieldLabel: "Your gender",
    options: GENDER_OPTIONS,
    guidance:
      "Mila only includes makeup guidance and shopping links for makeup-eligible selections. This never gets inferred — you choose it, and you can change it any time.",
    requiredMessage: "Select an option to continue.",
    back: "color-result",
    next: "skin-depth",
  },
  "skin-depth": {
    field: "skin_depth",
    fieldLabel: "Your skin depth",
    options: SKIN_DEPTH_OPTIONS,
    guidance:
      "How light or deep your skin tone is, separate from your undertone (warm/cool/neutral). This helps Mila put your own face in generated looks accurately.",
    requiredMessage: "Select a skin depth to continue.",
    back: "gender",
    next: "body-type",
  },
  "body-type": {
    field: "body_type",
    fieldLabel: "Your silhouette",
    options: BODY_OPTIONS,
    guidance:
      "Choose the shape that most closely describes how your shoulders, waist, and hips relate to one another. This drives every cut, drape, and proportion recommendation — there's no wrong answer.",
    requiredMessage: "Select a body silhouette to continue.",
    back: "skin-depth",
    next: "measurements",
  },
  "face-shape": {
    field: "face_shape",
    fieldLabel: "Your face shape",
    options: FACE_SHAPE_OPTIONS,
    guidance:
      "Pick whichever shape reads closest — Mila uses this to guide hairstyling, eyewear, and framing suggestions. You can always refine it later.",
    requiredMessage: "Select a face shape to continue.",
    back: "measurements",
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
    next: "hair-length",
  },
  "hair-length": {
    field: "hair_length",
    fieldLabel: "Your hair length",
    options: HAIR_LENGTH_OPTIONS,
    guidance:
      "Mila only recommends hairstyles achievable at this length — no extensions, no added length assumed.",
    requiredMessage: "Select a hair length to continue.",
    back: "hair-type",
    next: MAKEUP_ELIGIBLE_NEXT,
  },
  "makeup-preference": {
    field: "makeup_preference",
    fieldLabel: "Your makeup preference",
    options: MAKEUP_PREFERENCE_OPTIONS,
    guidance:
      "How much makeup guidance do you want in your daily look? You can change this any time from Style Profile.",
    requiredMessage: "Select an option to continue.",
    back: "hair-length",
    next: MAKEUP_SKIP_NEXT,
  },
} as const satisfies Record<
  string,
  {
    field:
      | "gender"
      | "skin_depth"
      | "body_type"
      | "face_shape"
      | "hair_type"
      | "hair_length"
      | "makeup_preference";
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

  useEffect(() => {
    if (step === "makeup-preference" && profile?.gender === "Male") {
      onStepChange(MAKEUP_SKIP_NEXT, { replace: true });
    }
  }, [step, profile?.gender, onStepChange]);

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
      trackEvent(supabase, user.id, "onboarding_completed");
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
          onBack={() => goTo("color-path")}
          onReviewAnother={() => {
            setPendingCandidate(null);
            goTo("color-path");
          }}
          onConfirmed={() => {
            setPendingCandidate(null);
            goTo("gender");
          }}
        />
      )}

      {selectStep && !(step === "makeup-preference" && profile?.gender === "Male") && (
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

      {step === "measurements" && (
        <MeasurementsStep
          heightCm={profile?.height_cm ?? null}
          weightKg={profile?.weight_kg ?? null}
          onBack={() => goTo("body-type")}
          onSaved={() => goTo("face-shape")}
        />
      )}

      {step === "beauty-preferences" && (
        <BeautyPreferencesStep
          value={beautyPrefs}
          onBack={() => goTo(profile?.gender === "Male" ? "hair-length" : "makeup-preference")}
          onSaved={() => goTo("location")}
        />
      )}

      {step === "location" && (
        <LocationStep
          value={profile?.default_location ?? null}
          onBack={() => goTo("beauty-preferences")}
          onSaved={() => goTo("shopping-preferences")}
        />
      )}

      {step === "shopping-preferences" && (
        <TagSelectStep
          field="shopping_preferences"
          tags={SHOPPING_PREFERENCE_TAGS}
          value={
            Array.isArray(profile?.shopping_preferences)
              ? (profile!.shopping_preferences as unknown[]).filter(
                  (t): t is string => typeof t === "string",
                )
              : []
          }
          guidance="Select any style, fit, coverage, color, footwear, sizing, or budget preferences Mila should factor into shopping recommendations. This step is optional."
          ariaLabel="Shopping preferences"
          emptyHint="No shopping preferences selected — Mila will recommend without a bias, and you can add these any time from Style Profile."
          onBack={() => goTo("location")}
          onSaved={() => goTo("styling-constraints")}
        />
      )}

      {step === "styling-constraints" && (
        <TagSelectStep
          field="styling_constraints"
          tags={STYLING_CONSTRAINT_TAGS}
          value={
            Array.isArray(profile?.styling_constraints)
              ? (profile!.styling_constraints as unknown[]).filter(
                  (t): t is string => typeof t === "string",
                )
              : []
          }
          guidance="Select any prep-time limits, tools, or other constraints Mila should respect when recommending hairstyles and outfits. This step is optional."
          ariaLabel="Styling constraints"
          emptyHint="No styling constraints selected — Mila will assume no special constraints, and you can add these any time from Style Profile."
          onBack={() => goTo("shopping-preferences")}
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
