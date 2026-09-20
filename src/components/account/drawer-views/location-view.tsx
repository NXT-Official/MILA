import { Check } from "lucide-react";
import { HUBS } from "@/constants/climate";

interface LocationViewProps {
  defaultHubId: string;
  onSelectHub: (hubId: string) => void;
}

export function LocationView({ defaultHubId, onSelectHub }: LocationViewProps) {
  return (
    <div className="space-y-3">
      <p className="atelier-label">Climate sync hub</p>
      <div className="rounded-xl border border-porcelain/30 overflow-hidden divide-y divide-porcelain/30">
        {HUBS.map((h) => (
          <button key={h.id} onClick={() => onSelectHub(h.id)} className="atelier-row-action">
            <span className="text-sm text-ink">{h.city}</span>
            <span className="flex items-center gap-3 text-micro uppercase tracking-label text-stone">
              {h.tagline}
              {defaultHubId === h.id && <Check className="size-3.5 text-ink" strokeWidth={1.6} />}
            </span>
          </button>
        ))}
      </div>
      <p className="text-micro text-stone leading-relaxed px-1">
        Your default hub sets the dashboard climate sync each time you open the studio.
      </p>
    </div>
  );
}
