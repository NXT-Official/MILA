import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileSectionCard } from "@/components/style-profile/profile-section-card";
import { SEASON_TILE_TINTS } from "@/components/style-profile/season-tints";
import { KNOWN_SEASON_GROUPS, SEASONS_MASTER_DATA } from "@/constants/style-profile";

export function KnownSeasonPicker({
  knownTileId,
  onSelectTile,
  confirming,
  onConfirm,
}: {
  knownTileId: string | null;
  onSelectTile: (tileId: string) => void;
  confirming: boolean;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ProfileSectionCard>
      <div className="text-center">
        <p className="atelier-kicker">Path 01 · Know Your Season</p>
        <h2 className="font-serif text-2xl sm:text-3xl tracking-tight mt-2">
          Select Your Known Color Profile
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed mt-2 max-w-md mx-auto">
          Already know your seasonal palette? Tap your look below and confirm — your palette loads
          instantly, no camera needed.
        </p>
      </div>
      <div className="mt-8 space-y-7">
        {KNOWN_SEASON_GROUPS.map((group) => (
          <div key={group.season}>
            <div className="flex items-center gap-3">
              <span className="h-px w-6 bg-foreground/30" />
              <p className="text-micro uppercase tracking-label-max text-foreground/70">
                {group.season}
              </p>
              <span className="h-px flex-1 bg-foreground/10" />
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {group.tiles.map((tile) => {
                const active = knownTileId === tile.id;
                return (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => onSelectTile(tile.id)}
                    style={
                      active ? undefined : { backgroundColor: SEASON_TILE_TINTS[group.season] }
                    }
                    className={`group text-left border rounded-xl px-3 py-3 transition-all min-h-17 ${
                      active
                        ? "border-foreground bg-foreground/4 -translate-y-px ring-1 ring-foreground"
                        : "border-border hover:border-foreground/40"
                    }`}
                  >
                    <p className="text-label uppercase tracking-label-wide flex items-center justify-between gap-2">
                      <span>{tile.label}</span>
                      {active && <Check className="size-3" />}
                    </p>
                    <p className="mt-1 text-micro text-muted-foreground leading-relaxed">
                      {SEASONS_MASTER_DATA[tile.key].subSeason}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-col items-center">
        <Button
          disabled={!knownTileId || confirming}
          size="md"
          className="w-full sm:w-auto px-8"
          onClick={onConfirm}
        >
          {confirming ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          Confirm Selection
        </Button>
        <p className="mt-3 text-micro uppercase tracking-label-xwide text-accent text-center">
          {knownTileId
            ? "Loads from our atelier library · Saved to your profile"
            : "Select a season above to confirm."}
        </p>
      </div>
    </ProfileSectionCard>
  );
}
