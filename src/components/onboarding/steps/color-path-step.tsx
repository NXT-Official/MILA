import { useState } from "react";
import { Camera, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type StudioColorProfile } from "@/lib/analyzePersonalColor.functions";
import {
  SEASONS_MASTER_DATA,
  KNOWN_SEASON_GROUPS,
  SEASON_HEX_MATRIX,
  type StudioTelemetry,
  type DetailedColorProfile as StudioDossier,
} from "@/constants/style-profile";
import { VisualDiagnosticViewfinder } from "@/components/style-profile/visual-diagnostic-viewfinder";
import { StepFooter } from "@/components/onboarding/step-shell";

function knownTileToCandidate(
  key: keyof typeof SEASONS_MASTER_DATA,
  label: string,
  prev: StudioDossier | null,
): StudioColorProfile {
  const spec = SEASONS_MASTER_DATA[key];
  return {
    ...spec,
    faceShape: prev?.faceShape ?? "Oval Frame",
    bodyType: prev?.bodyType ?? "Hourglass",
    stylistNote: `Chosen by hand · ${label}. Every swatch, beauty note, and color to avoid below is drawn straight from the atelier's ${spec.subSeason} library.`,
    fullPalette: SEASON_HEX_MATRIX[key],
    detectedLighting: "Manual Studio Calibration",
    calculatedUndertone: spec.toneType,
    confidenceScore: 100,
  } as StudioColorProfile;
}

export function ColorPathStep({
  existingDossier,
  onCandidateReady,
  onContinueExisting,
}: {
  existingDossier: StudioDossier | null;
  onCandidateReady: (profile: StudioColorProfile, telemetry?: StudioTelemetry) => void;
  onContinueExisting: () => void;
}) {
  const [showKnown, setShowKnown] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [knownTileId, setKnownTileId] = useState<string | null>(null);

  return (
    <div>
      {existingDossier ? (
        <div className="mb-6 rounded-card border border-line bg-accent-soft/40 p-5">
          <p className="text-sm font-medium text-ink">
            You already have a saved result: {existingDossier.subSeason}
          </p>
          <p className="mt-1 text-xs text-muted">
            Keep it, or choose a different season / re-analyze below.
          </p>
          <Button className="mt-3" size="sm" variant="secondary" onClick={onContinueExisting}>
            <Check className="size-3.5" aria-hidden="true" />
            Continue with {existingDossier.season}
          </Button>
        </div>
      ) : null}

      {!showKnown ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setShowKnown(true)}
            className="mila-focus-ring rounded-card border border-line bg-surface p-5 text-left transition-colors hover:border-accent"
          >
            <Sparkles className="size-4 text-accent" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-ink">I know my season</p>
            <p className="mt-1 text-xs text-muted leading-relaxed">
              Pick your seasonal palette from our full sixteen-season library. No camera needed.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="mila-focus-ring rounded-card border border-line bg-surface p-5 text-left transition-colors hover:border-accent"
          >
            <Camera className="size-4 text-accent" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-ink">Analyze my coloring</p>
            <p className="mt-1 text-xs text-muted leading-relaxed">
              Use your camera and Mila reads your true tones live, in good natural light.
            </p>
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Tap the sub-season closest to your coloring.</p>
            <button
              type="button"
              onClick={() => setShowKnown(false)}
              className="mila-focus-ring text-xs text-accent hover:underline"
            >
              Choose a different path
            </button>
          </div>
          <div role="radiogroup" aria-label="Known seasonal palette" className="mt-4 space-y-6">
            {KNOWN_SEASON_GROUPS.map((group) => (
              <div key={group.season}>
                <p className="text-[10px] uppercase tracking-[0.32em] text-muted">{group.season}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {group.tiles.map((tile) => {
                    const active = knownTileId === tile.id;
                    return (
                      <button
                        key={tile.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setKnownTileId(tile.id)}
                        className={`mila-focus-ring rounded-control border px-3 py-3 text-left transition-colors ${
                          active
                            ? "border-ink bg-accent-soft/60"
                            : "border-line hover:border-accent"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2 text-xs font-medium text-ink">
                          {tile.label}
                          {active && <Check className="size-3.5" aria-hidden="true" />}
                        </span>
                        <span className="mt-1 block text-[11px] text-muted">
                          {SEASONS_MASTER_DATA[tile.key].subSeason}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <StepFooter
            onBack={() => setShowKnown(false)}
            continueLabel="Preview this palette"
            continueDisabled={!knownTileId}
            onContinue={() => {
              const tile = KNOWN_SEASON_GROUPS.flatMap((g) => g.tiles).find(
                (t) => t.id === knownTileId,
              );
              if (!tile) return;
              onCandidateReady(knownTileToCandidate(tile.key, tile.label, existingDossier));
            }}
          />
        </div>
      )}

      {cameraOpen && (
        <VisualDiagnosticViewfinder
          onClose={() => setCameraOpen(false)}
          onComplete={async (profile, telemetry) => {
            setCameraOpen(false);
            onCandidateReady(profile, telemetry);
          }}
        />
      )}
    </div>
  );
}
