import { UNDERTONES, SEASONS, BODIES, FACE_SHAPES, HAIR_TYPES } from "@/constants/style-profile";
import { isNonEmptyColorProfile } from "@/lib/style-profile/completion";
import type { DashboardProfile } from "@/lib/queries/profile";

export type OnboardingStepId =
  | "welcome"
  | "color-path"
  | "color-result"
  | "body-type"
  | "face-shape"
  | "hair-type"
  | "beauty-preferences"
  | "location"
  | "review";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  shortTitle: string;
  description?: string;
  optional?: boolean;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: "welcome", title: "Welcome to Mila", shortTitle: "Welcome" },
  {
    id: "color-path",
    title: "Your coloring",
    shortTitle: "Coloring",
    description: "Tell us what you already know, or let Mila read it live.",
  },
  {
    id: "color-result",
    title: "Confirm your color profile",
    shortTitle: "Color result",
  },
  {
    id: "body-type",
    title: "Body silhouette",
    shortTitle: "Silhouette",
  },
  {
    id: "face-shape",
    title: "Face shape",
    shortTitle: "Face shape",
  },
  {
    id: "hair-type",
    title: "Hair type",
    shortTitle: "Hair type",
  },
  {
    id: "beauty-preferences",
    title: "Beauty preferences",
    shortTitle: "Beauty",
    description: "Select the types of recommendations you want Mila to prioritize.",
    optional: true,
  },
  {
    id: "location",
    title: "Location & weather",
    shortTitle: "Location",
    description: "Mila can adapt recommendations to your weather.",
    optional: true,
  },
  { id: "review", title: "Your Mila profile is ready", shortTitle: "Review" },
];

/** Steps shown in the "Step X of N" progress indicator — everything but welcome. */
export const COUNTED_STEPS = ONBOARDING_STEPS.filter((s) => s.id !== "welcome");

export const ONBOARDING_STEP_IDS = ONBOARDING_STEPS.map((s) => s.id) as OnboardingStepId[];

export function sanitizeOnboardingStep(value: unknown): OnboardingStepId | undefined {
  return typeof value === "string" && (ONBOARDING_STEP_IDS as string[]).includes(value)
    ? (value as OnboardingStepId)
    : undefined;
}

export function getOnboardingStep(id: OnboardingStepId): OnboardingStep {
  const step = ONBOARDING_STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`Unknown onboarding step "${id}"`);
  return step;
}

export function getOnboardingStepIndex(id: OnboardingStepId): number {
  return COUNTED_STEPS.findIndex((s) => s.id === id);
}

type ProfileSnapshot = Pick<
  DashboardProfile,
  | "skin_undertone"
  | "color_season_base"
  | "color_profile"
  | "body_type"
  | "face_shape"
  | "hair_type"
>;

export function hasColorProfile(profile: ProfileSnapshot | null | undefined): boolean {
  if (!profile) return false;
  return (
    (UNDERTONES as readonly string[]).includes(profile.skin_undertone ?? "") &&
    (SEASONS as readonly string[]).includes(profile.color_season_base ?? "") &&
    isNonEmptyColorProfile(profile.color_profile)
  );
}

export function hasBodyType(profile: ProfileSnapshot | null | undefined): boolean {
  return !!profile && (BODIES as readonly string[]).includes(profile.body_type ?? "");
}

export function hasFaceShape(profile: ProfileSnapshot | null | undefined): boolean {
  return !!profile && (FACE_SHAPES as readonly string[]).includes(profile.face_shape ?? "");
}

export function hasHairType(profile: ProfileSnapshot | null | undefined): boolean {
  return !!profile && (HAIR_TYPES as readonly string[]).includes(profile.hair_type ?? "");
}

/** Required steps only — beauty preferences and location are always considered complete. */
export function isOnboardingStepComplete(
  step: OnboardingStepId,
  profile: ProfileSnapshot | null | undefined,
): boolean {
  switch (step) {
    case "welcome":
      return true;
    // color-path is a chooser with no persisted data of its own — the
    // actual required checkpoint is color-result. Treating color-path as
    // "complete" only once hasColorProfile is true would make color-result
    // (which requires color-path to be complete, per
    // isOnboardingStepReachable) permanently unreachable, since
    // hasColorProfile only becomes true *after* color-result is saved.
    case "color-path":
      return true;
    case "color-result":
      return hasColorProfile(profile);
    case "body-type":
      return hasBodyType(profile);
    case "face-shape":
      return hasFaceShape(profile);
    case "hair-type":
      return hasHairType(profile);
    case "beauty-preferences":
    case "location":
      return true;
    case "review":
      return (
        hasColorProfile(profile) &&
        hasBodyType(profile) &&
        hasFaceShape(profile) &&
        hasHairType(profile)
      );
  }
}

function isBlankProfile(profile: ProfileSnapshot | null | undefined): boolean {
  return (
    !hasColorProfile(profile) &&
    !hasBodyType(profile) &&
    !hasFaceShape(profile) &&
    !hasHairType(profile)
  );
}

/** Where a returning user should land: the welcome screen only for a truly blank profile. */
export function getFirstIncompleteOnboardingStep(
  profile: ProfileSnapshot | null | undefined,
): OnboardingStepId {
  if (isBlankProfile(profile)) return "welcome";
  if (!hasColorProfile(profile)) return "color-path";
  if (!hasBodyType(profile)) return "body-type";
  if (!hasFaceShape(profile)) return "face-shape";
  if (!hasHairType(profile)) return "hair-type";
  return "beauty-preferences";
}

export function getNextOnboardingStep(current: OnboardingStepId): OnboardingStepId | null {
  const steps = ONBOARDING_STEPS;
  const index = steps.findIndex((s) => s.id === current);
  if (index === -1 || index === steps.length - 1) return null;
  return steps[index + 1].id;
}

export function getPreviousOnboardingStep(current: OnboardingStepId): OnboardingStepId | null {
  const steps = ONBOARDING_STEPS;
  const index = steps.findIndex((s) => s.id === current);
  if (index <= 0) return null;
  return steps[index - 1].id;
}

/**
 * A step is reachable only if every required step strictly before it is
 * already complete — prevents skipping ahead via the `step` search param.
 */
export function isOnboardingStepReachable(
  step: OnboardingStepId,
  profile: ProfileSnapshot | null | undefined,
): boolean {
  const index = ONBOARDING_STEPS.findIndex((s) => s.id === step);
  if (index <= 0) return true;
  for (let i = 0; i < index; i++) {
    const prior = ONBOARDING_STEPS[i];
    if (!prior.optional && !isOnboardingStepComplete(prior.id, profile)) return false;
  }
  return true;
}
