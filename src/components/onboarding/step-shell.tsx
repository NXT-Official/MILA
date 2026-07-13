import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveStatusIndicator, type SaveStatus } from "./save-status";

export function StepFooter({
  onBack,
  onContinue,
  continueLabel = "Continue",
  continueType = "button",
  continueDisabled,
  continueLoading,
  saveStatus = "idle",
  onRetrySave,
}: {
  onBack?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  continueType?: "button" | "submit";
  continueDisabled?: boolean;
  continueLoading?: boolean;
  saveStatus?: SaveStatus;
  onRetrySave?: () => void;
}) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
      <SaveStatusIndicator status={saveStatus} onRetry={onRetrySave} />
      <div className="flex items-center gap-3 sm:ml-auto">
        {onBack ? (
          <Button type="button" variant="outline" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </Button>
        ) : null}
        <Button
          type={continueType}
          onClick={continueType === "button" ? onContinue : undefined}
          disabled={continueDisabled}
          loading={continueLoading}
        >
          {continueLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
