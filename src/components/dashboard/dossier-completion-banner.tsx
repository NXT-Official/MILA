import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { dossierCompletion } from "@/lib/style-profile/completion";
import type { DashboardProfile } from "@/lib/queries/profile";

const DISMISSED_KEY = "mila.dossier-banner-dismissed";

/**
 * Nudges the member toward the dossier signals onboarding let them skip. It
 * never blocks — one dismissal and it stays gone, so a member who has decided
 * against beauty preferences is not asked twice.
 */
export function DossierCompletionBanner({ profile }: { profile: DashboardProfile | undefined }) {
  const [dismissed, setDismissed] = useState(true);

  // Read on the client only; the server has no localStorage and would hydrate wrong.
  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
  }, []);

  const { percent, missing } = dossierCompletion(profile);
  if (dismissed || !profile || missing.length === 0) return null;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  return (
    <section
      aria-labelledby="dossier-completion-heading"
      className="atelier-card mb-6 flex items-start gap-4 p-5 sm:p-6"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2
            id="dossier-completion-heading"
            className="font-serif text-lg leading-snug tracking-tight"
          >
            Your dossier is {percent}% complete
          </h2>
          <p className="text-xs text-muted-foreground">Still to add: {missing.join(", ")}.</p>
        </div>

        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-labelledby="dossier-completion-heading"
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-accent/15"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>

        <Link
          to="/style-profile"
          className="atelier-focus-ring mt-3 inline-block text-xs uppercase tracking-label text-accent hover:underline"
        >
          Complete your dossier
        </Link>
      </div>

      <IconButton variant="ghost" label="Dismiss" onClick={dismiss}>
        <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </IconButton>
    </section>
  );
}
