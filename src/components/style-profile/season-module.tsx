import { useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileSectionCard } from "@/components/style-profile/profile-section-card";
import { SeasonTileGrid } from "@/components/style-profile/season-tile-grid";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { DetailedColorProfile as StudioDossier } from "@/constants/style-profile";

export function SeasonModule({
  hasRealDossier,
  dossier,
  knownTileId,
  onSelectTile,
  confirming,
  onConfirmTile,
  onOpenCamera,
  fineTuneOpen,
  onFineTuneOpenChange,
}: {
  hasRealDossier: boolean;
  dossier: StudioDossier;
  knownTileId: string | null;
  onSelectTile: (tileId: string) => void;
  confirming: boolean;
  onConfirmTile: () => Promise<void>;
  onOpenCamera: () => void;
  fineTuneOpen: boolean;
  onFineTuneOpenChange: (open: boolean) => void;
}) {
  const [changing, setChanging] = useState(false);
  const showChooser = !hasRealDossier || changing;

  return (
    <>
      <ProfileSectionCard>
        <div className="text-center">
          <p className="atelier-kicker">Your Color Season</p>
          {hasRealDossier && !changing ? (
            <>
              <h2 className="font-serif text-2xl sm:text-3xl tracking-tight mt-2">
                {dossier.subSeason}
              </h2>
              <div className="mt-4 flex items-center justify-center gap-2">
                {dossier.primarySwatches.slice(0, 4).map((s, i) => (
                  <span
                    key={`${s.hex}-${i}`}
                    className="size-6 rounded-full border border-border/60"
                    style={{ backgroundColor: s.hex }}
                    title={s.name}
                  />
                ))}
              </div>
              <div className="mt-6 flex items-center justify-center gap-3">
                <Button variant="outline" size="sm" onClick={() => setChanging(true)}>
                  Change
                </Button>
                <Button variant="outline" size="sm" onClick={() => onFineTuneOpenChange(true)}>
                  Fine-tune
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="font-serif text-2xl sm:text-3xl tracking-tight mt-2">
                Find your seasonal palette
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed mt-2 max-w-md mx-auto">
                Two ways in — let the camera read your light, or tell us your season directly if you
                already know it.
              </p>
            </>
          )}
        </div>

        {showChooser && (
          <div className="mt-8 space-y-8">
            <div className="flex flex-col items-center text-center gap-3 pb-6 border-b border-border/60">
              <Button size="md" className="w-full sm:w-auto px-8" onClick={onOpenCamera}>
                <Camera aria-hidden="true" />
                Take the camera read
              </Button>
              {changing && (
                <button
                  type="button"
                  onClick={() => setChanging(false)}
                  className="text-micro uppercase tracking-label-xwide text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
            <div>
              <p className="text-micro uppercase tracking-label-max text-accent text-center mb-5">
                Or — I already know my season
              </p>
              <SeasonTileGrid
                selectedTileId={knownTileId}
                onSelectTile={onSelectTile}
                confirming={confirming}
                onConfirm={async () => {
                  await onConfirmTile();
                  setChanging(false);
                }}
              />
            </div>
          </div>
        )}
      </ProfileSectionCard>

      <Sheet open={fineTuneOpen} onOpenChange={onFineTuneOpenChange}>
        <SheetContent
          side="bottom"
          className="bg-ink text-surface border-t border-surface/10 rounded-t-2xl max-h-[85vh] overflow-y-auto"
        >
          <SheetHeader className="text-left">
            <p className="text-nano uppercase tracking-label-max text-surface/50">Seoul Atelier</p>
            <SheetTitle className="font-serif text-2xl tracking-tight text-surface">
              Fine-tune your seasonal palette
            </SheetTitle>
            <SheetDescription className="text-label text-surface/60 leading-relaxed">
              Cameras can read light and shadow differently than the eye. Pick your true sub-season
              — your palette, beauty notes, and colors to avoid update from the atelier library, and
              your confidence chip locks to 100% Studio Tuned.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 pb-6">
            <SeasonTileGrid
              tone="dark"
              selectedTileId={knownTileId}
              onSelectTile={onSelectTile}
              confirming={confirming}
              confirmLabel="Apply to my dossier"
              onConfirm={async () => {
                await onConfirmTile();
                onFineTuneOpenChange(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
