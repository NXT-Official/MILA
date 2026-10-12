import { CircleAlert, Loader2, Palette, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useColorReadJob, type ColorReadOffer } from "@/hooks/use-color-read-job";
import type { StudioColorProfile } from "@/lib/analyzePersonalColor.functions";
import type { StudioTelemetry } from "@/constants/style-profile";
import { cn } from "@/lib/utils";

const COPY: Record<ColorReadOffer, { title: string; body: string | null }> = {
  running: {
    title: "Mila is still reading your colors.",
    body: "You can leave this page. Your result will be here.",
  },
  ready: { title: "Your color read is ready.", body: null },
  failed: {
    title: "Your last color read didn't finish. Any credit it used has been returned.",
    body: null,
  },
  lost: { title: "The connection dropped before your color read came back.", body: null },
};

const ICONS = { running: Loader2, ready: Palette, failed: CircleAlert, lost: WifiOff } as const;

/**
 * Where her colour read stands, with what she can do about it. Presentational:
 * the viewfinder renders it for a read it follows, and ColorReadRecoveryCard
 * for her latest read on a page.
 *
 * - running: no button; the result waits in her job row.
 * - ready: "See my result" and "Dismiss".
 * - failed: "Try again" when there is somewhere to start a new read, else "Dismiss".
 * - lost: "Try again". `resendable` says the same request (same id) goes again,
 *   so the server replays a read that did arrive instead of charging twice.
 */
export function ColorReadRecoveryView({
  offer,
  onSeeResult,
  onDismiss,
  onTryAgain,
  resendable = false,
  className,
}: {
  offer: ColorReadOffer;
  onSeeResult?: () => void;
  onDismiss?: () => void;
  onTryAgain?: () => void;
  resendable?: boolean;
  className?: string;
}) {
  const copy = COPY[offer];
  const body =
    offer === "lost"
      ? resendable
        ? "Try again. You won't be charged twice."
        : "Please try again."
      : copy.body;
  const Icon = ICONS[offer];
  const tryAgain = (offer === "failed" || offer === "lost") && onTryAgain;
  const dismiss = (offer === "ready" || (offer === "failed" && !onTryAgain)) && onDismiss;

  return (
    <section
      aria-label="Your color read"
      className={cn(
        "rounded-card border border-border bg-card p-5 text-card-foreground shadow-paper sm:p-6",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground",
            offer === "running" && "animate-spin motion-reduce:animate-none",
          )}
        />
        <div className="min-w-0">
          <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
            {copy.title}
          </p>
          {body && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>}
        </div>
      </div>
      {(offer === "ready" || tryAgain || dismiss) && (
        <div className="mt-4 flex flex-wrap gap-3">
          {offer === "ready" && onSeeResult && (
            <Button type="button" size="md" onClick={onSeeResult}>
              See my result
            </Button>
          )}
          {tryAgain && (
            <Button type="button" size="md" onClick={onTryAgain}>
              Try again
            </Button>
          )}
          {dismiss && (
            <Button type="button" size="md" variant="outline" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Her latest colour read on a page (D-W4 My Style, D-W6 the colour path), so
 * a reload, a closed tab or a long wait comes back to "Mila is still reading
 * your colors", then to "Your color read is ready". Renders nothing when
 * there is nothing to offer, and nothing until the generation_jobs migration
 * is applied.
 *
 * - `readJobId`: the job her saved dossier came from (`dossier.readJobId`).
 * - `appliedAt`: when her current colour profile was saved, by a read or a
 *   quiz. A read that finished before it is not offered.
 * - `onUseResult`: called with the stored read and its job id. Choosing it
 *   also dismisses it, so it is never offered twice.
 * - `onTryAgain`: where a new read starts (opening the camera). Without it a
 *   failed read offers only "Dismiss".
 */
export function ColorReadRecoveryCard({
  readJobId,
  onUseResult,
  appliedAt = null,
  onTryAgain,
  className,
  now,
}: {
  readJobId: string | null;
  onUseResult: (
    profile: StudioColorProfile,
    telemetry: StudioTelemetry,
    jobId: string,
  ) => Promise<void> | void;
  appliedAt?: string | null;
  onTryAgain?: () => void;
  className?: string;
  /** The clock, for tests. Defaults to the tab's server-time estimate. */
  now?: () => number;
}) {
  const { user } = useAuth();
  const colorRead = useColorReadJob(user?.id, { usedJobId: readJobId, appliedAt, now });
  const { offer, job, read, dismiss } = colorRead;
  if (!offer || offer === "lost" || !job) return null;
  if (offer === "ready" && !read) return null;

  return (
    <ColorReadRecoveryView
      offer={offer}
      className={className}
      onSeeResult={() => {
        if (!read) return;
        dismiss(job.id);
        void onUseResult(
          read.profile,
          { ...read.telemetry, source: read.telemetry.forcedDiagnostic ? "stress-test" : "live" },
          job.id,
        );
      }}
      onDismiss={() => dismiss(job.id)}
      onTryAgain={
        onTryAgain
          ? () => {
              dismiss(job.id);
              onTryAgain();
            }
          : undefined
      }
    />
  );
}
