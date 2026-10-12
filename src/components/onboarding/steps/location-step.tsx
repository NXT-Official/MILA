import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, MapPin } from "lucide-react";
import { HUBS } from "@/constants/climate";
import { queryKeys } from "@/constants/query-keys";
import { attemptSaveDefaultHub } from "@/lib/default-hub";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

export function LocationStep({
  value,
  onBack,
  onSaved,
}: {
  value: string | null;
  onBack: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(value);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSetLocation() {
    if (!selected) return;
    setSaving(true);
    setFailed(false);
    const { ok } = await attemptSaveDefaultHub(user?.id, selected);
    if (!ok) {
      setFailed(true);
      setSaving(false);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.profile(user?.id) });
    setSaving(false);
    onSaved();
  }

  return (
    <LocationStepView
      selected={selected}
      onSelect={setSelected}
      saving={saving}
      failed={failed}
      onSubmit={handleSetLocation}
      onBack={onBack}
      onSkip={onSaved}
    />
  );
}

export function LocationStepView({
  selected,
  onSelect,
  saving,
  failed,
  onSubmit,
  onBack,
  onSkip,
}: {
  selected: string | null;
  onSelect: (hubId: string) => void;
  saving: boolean;
  /** The last save did not go through; her pick is kept so she can retry. */
  failed: boolean;
  onSubmit: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <p className="mb-6 max-w-reading text-sm text-muted leading-relaxed">
        Mila can adapt daily recommendations to your weather. This step is optional, and you can set
        it later from Style Profile.
      </p>
      <div role="radiogroup" aria-label="Weather hub" className="grid gap-2 sm:grid-cols-2">
        {HUBS.map((hub) => {
          const active = selected === hub.id;
          return (
            <button
              key={hub.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(hub.id)}
              className={`atelier-focus-ring flex items-center justify-between gap-2 rounded-control border px-4 py-3 text-left transition-colors ${
                active ? "border-ink bg-accent-soft/60" : "border-line hover:border-accent"
              }`}
            >
              <span>
                <span className="block text-sm font-medium text-ink">{hub.city}</span>
                <span className="block text-xs text-muted">{hub.tagline}</span>
              </span>
              {active && <Check className="size-4 shrink-0" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {failed ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          We couldn't save your location. Your selection is still here, so try again when you're
          ready.
        </p>
      ) : null}
      <div className="mt-8 flex flex-col-reverse gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onSkip}
          className="atelier-focus-ring min-h-11 text-xs text-muted hover:text-ink hover:underline"
        >
          I'll do this later
        </button>
        <div className="flex items-center gap-3 sm:ml-auto">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="button" disabled={!selected} loading={saving} onClick={onSubmit}>
            <MapPin className="size-4" aria-hidden="true" />
            {failed ? "Try again" : "Set my location"}
          </Button>
        </div>
      </div>
    </div>
  );
}
