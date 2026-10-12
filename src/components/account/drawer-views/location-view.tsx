import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HUBS } from "@/constants/climate";

interface LocationViewProps {
  defaultHubId: string;
  onSelectHub: (hubId: string) => void;
  /** The hub being saved right now; rows lock until it settles. */
  savingHubId?: string | null;
  /** The hub whose last save failed; shows a retry. */
  failedHubId?: string | null;
}

export function LocationView({
  defaultHubId,
  onSelectHub,
  savingHubId = null,
  failedHubId = null,
}: LocationViewProps) {
  const saving = savingHubId !== null;
  const failedCity = failedHubId ? HUBS.find((h) => h.id === failedHubId)?.city : undefined;

  return (
    <div className="space-y-3">
      <p className="atelier-label">Climate sync hub</p>
      {failedHubId ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-control border border-destructive/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-ink">
            We couldn't save your location{failedCity ? ` as ${failedCity}` : ""}. Your choice
            hasn't changed.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11 aria-disabled:cursor-wait aria-disabled:opacity-60"
            aria-disabled={saving || undefined}
            onClick={() => {
              if (!saving) onSelectHub(failedHubId);
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      <div className="rounded-xl border border-porcelain/30 overflow-hidden divide-y divide-porcelain/30">
        {HUBS.map((h) => (
          <button
            key={h.id}
            type="button"
            // aria-disabled, not disabled: a disabled button drops keyboard focus
            // mid-save, so she would land back at the top of the page.
            aria-disabled={saving || undefined}
            aria-current={defaultHubId === h.id ? "true" : undefined}
            onClick={() => {
              if (!saving) onSelectHub(h.id);
            }}
            className="atelier-row-action aria-disabled:cursor-wait aria-disabled:opacity-60"
          >
            <span className="text-sm text-ink">{h.city}</span>
            <span className="flex items-center gap-3 text-micro uppercase tracking-label text-stone">
              {h.tagline}
              {savingHubId === h.id ? (
                <Loader2 className="size-3.5 animate-spin text-ink" aria-hidden="true" />
              ) : defaultHubId === h.id ? (
                <Check className="size-3.5 text-ink" strokeWidth={1.6} aria-hidden="true" />
              ) : null}
            </span>
          </button>
        ))}
      </div>
      <p role="status" className="sr-only">
        {saving ? "Saving your location" : ""}
      </p>
      <p className="text-micro text-stone leading-relaxed px-1">
        Your default hub sets the dashboard climate sync each time you open the studio.
      </p>
    </div>
  );
}
