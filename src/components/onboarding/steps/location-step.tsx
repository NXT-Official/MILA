import { useState } from "react";
import { Check, MapPin } from "lucide-react";
import { HUBS } from "@/constants/climate";
import { saveDefaultHubId } from "@/lib/default-hub";
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
  const [selected, setSelected] = useState<string | null>(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSetLocation() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await saveDefaultHubId(user?.id, selected);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save this step.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="mb-6 max-w-reading text-sm text-muted leading-relaxed">
        Mila can adapt daily recommendations to your weather. This step is optional — you can set it
        later from Style Profile.
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
              onClick={() => setSelected(hub.id)}
              className={`mila-focus-ring flex items-center justify-between gap-2 rounded-control border px-4 py-3 text-left transition-colors ${
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
      {error ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          We couldn't save this step. Your selection is still here — try again when you're ready.
        </p>
      ) : null}
      <div className="mt-8 flex flex-col-reverse gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onSaved}
          className="mila-focus-ring text-xs text-muted hover:text-ink hover:underline"
        >
          I'll do this later
        </button>
        <div className="flex items-center gap-3 sm:ml-auto">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="button" disabled={!selected} loading={saving} onClick={handleSetLocation}>
            <MapPin className="size-4" aria-hidden="true" />
            Set my location
          </Button>
        </div>
      </div>
    </div>
  );
}
