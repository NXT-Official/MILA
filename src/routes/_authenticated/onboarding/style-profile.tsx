import { createFileRoute } from "@tanstack/react-router";
import { StyleProfileOnboarding } from "@/components/onboarding/style-profile-onboarding";
import { sanitizeOnboardingStep, type OnboardingStepId } from "@/components/onboarding/steps";

export const Route = createFileRoute("/_authenticated/onboarding/style-profile")({
  validateSearch: (search: Record<string, unknown>): { step?: OnboardingStepId } => {
    const step = sanitizeOnboardingStep(search.step);
    return step ? { step } : {};
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { step } = Route.useSearch();
  const navigate = Route.useNavigate();

  function onStepChange(next: OnboardingStepId, opts?: { replace?: boolean }) {
    navigate({ search: (prev) => ({ ...prev, step: next }), replace: opts?.replace });
  }

  return <StyleProfileOnboarding step={step} onStepChange={onStepChange} />;
}
