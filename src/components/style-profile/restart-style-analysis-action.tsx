import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * The only discoverable entry point back into the full guided style-profile
 * onboarding wizard once onboarding is complete — every step there preloads
 * the user's current saved value, so this is non-destructive by default.
 */
export function RestartStyleAnalysisAction() {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
        Restart Style Analysis
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Restart your style analysis?"
        description="This walks you back through your full style profile, including gender and body type. Your current profile stays until you save changes."
        confirmLabel="Restart"
        cancelLabel="Cancel"
        onConfirm={() => navigate({ to: "/onboarding/style-profile", search: { restart: true } })}
      />
    </>
  );
}
