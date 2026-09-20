import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HUBS } from "@/constants/climate";

interface PreferencesViewProps {
  defaultHubId: string;
  onNavigate: (view: "security" | "location" | "privacy") => void;
  onSignOut: () => void;
  signingOut: boolean;
}

export function PreferencesView({
  defaultHubId,
  onNavigate,
  onSignOut,
  signingOut,
}: PreferencesViewProps) {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="atelier-label">Account details</p>
        <div className="rounded-xl border border-porcelain/30 overflow-hidden">
          <button
            onClick={() => onNavigate("security")}
            className="w-full flex items-center justify-between px-5 py-4 bg-background hover:bg-porcelain/20 transition-colors border-b border-porcelain/30"
          >
            <span className="text-sm text-ink">Email &amp; Security</span>
            <span className="text-stone">
              <ArrowRight className="size-3.5" strokeWidth={1.75} />
            </span>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="atelier-label">Styling parameters</p>
        <div className="rounded-xl border border-porcelain/30 overflow-hidden divide-y divide-porcelain/30">
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-sm text-ink">Climate Measurement</span>
            <span className="text-micro uppercase tracking-label text-stone">Celsius (°C)</span>
          </div>
          <button onClick={() => onNavigate("location")} className="atelier-row-action">
            <span className="text-sm text-ink">Default Location</span>
            <span className="flex items-center gap-3">
              <span className="text-micro uppercase tracking-label text-stone">
                {HUBS.find((h) => h.id === defaultHubId)?.city}
              </span>{" "}
              <span className="text-stone">
                <ArrowRight className="size-3.5" strokeWidth={1.75} />
              </span>
            </span>
          </button>
          <button onClick={() => onNavigate("privacy")} className="atelier-row-action">
            <span className="text-sm text-ink">Privacy &amp; Data</span>{" "}
            <span className="text-stone">
              <ArrowRight className="size-3.5" strokeWidth={1.75} />
            </span>
          </button>
        </div>
      </div>

      <div className="pt-4 border-t border-porcelain/30">
        <Button
          variant="destructive"
          size="sm"
          onClick={onSignOut}
          disabled={signingOut}
          className="w-full"
        >
          {signingOut && <Loader2 className="size-3.5 animate-spin" />}
          {signingOut ? "Signing Out…" : "Sign Out of Studio"}
        </Button>
      </div>
    </div>
  );
}
