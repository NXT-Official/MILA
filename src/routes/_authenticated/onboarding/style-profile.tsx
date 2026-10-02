import { createFileRoute } from "@tanstack/react-router";
import { StyleProfileOnboarding } from "@/components/onboarding/style-profile-onboarding";
import {
  sanitizeOnboardingStep,
  sanitizeRestartFlag,
  type OnboardingStepId,
} from "@/constants/steps";

type OnboardingSearch = { step?: OnboardingStepId; restart?: true };

export const Route = createFileRoute("/_authenticated/onboarding/style-profile")({
  validateSearch: (search: Record<string, unknown>): OnboardingSearch => {
    const step = sanitizeOnboardingStep(search.step);
    return {
      ...(step ? { step } : {}),
      ...(sanitizeRestartFlag(search.restart) ? { restart: true as const } : {}),
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { step, restart } = Route.useSearch();
  const navigate = Route.useNavigate();

  function onStepChange(next: OnboardingStepId, opts?: { replace?: boolean }) {
    navigate({
      search: (prev: OnboardingSearch) => ({ ...prev, step: next }),
      replace: opts?.replace,
    });
  }

  return (
    <StyleProfileOnboarding step={step} restart={restart === true} onStepChange={onStepChange} />
  );
}
