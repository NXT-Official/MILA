import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEASON_TILE_TINTS } from "@/components/style-profile/season-tints";
import { KNOWN_SEASON_GROUPS, SEASONS_MASTER_DATA } from "@/constants/style-profile";

const TONE = {
  light: {
    groupLabel: "text-foreground/70",
    rule: "bg-foreground/10",
    tileActive: "border-foreground bg-foreground/4 ring-1 ring-foreground",
    tileInactive: "border-border hover:border-foreground/40",
    tileLabel: "",
    tileCaption: "text-muted-foreground",
  },
  dark: {
    groupLabel: "text-surface/70",
    rule: "bg-surface/10",
    tileActive: "border-surface bg-surface/10 ring-1 ring-surface",
    tileInactive: "border-surface/15 hover:border-surface/60",
    tileLabel: "text-surface",
    tileCaption: "text-surface/55",
  },
} as const;

export function SeasonTileGrid({
  selectedTileId,
  onSelectTile,
  confirming,
  onConfirm,
  confirmLabel = "Confirm Selection",
  tone = "light",
}: {
  selectedTileId: string | null;
  onSelectTile: (tileId: string) => void;
  confirming: boolean;
  onConfirm: () => Promise<void>;
  confirmLabel?: string;
  tone?: "light" | "dark";
}) {
  const t = TONE[tone];
  return (
    <div>
      <div className="space-y-7">
        {KNOWN_SEASON_GROUPS.map((group) => (
          <div key={group.season}>
            <div className="flex items-center gap-3">
              <span className={`h-px w-6 ${t.rule}`} />
              <p className={`text-micro uppercase tracking-label-max ${t.groupLabel}`}>
                {group.season}
              </p>
              <span className={`h-px flex-1 ${t.rule}`} />
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {group.tiles.map((tile) => {
                const active = selectedTileId === tile.id;
                return (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => onSelectTile(tile.id)}
                    style={
                      active || tone === "dark"
                        ? undefined
                        : { backgroundColor: SEASON_TILE_TINTS[group.season] }
                    }
                    className={`group text-left border rounded-xl px-3 py-3 transition-all min-h-17 ${
                      active ? t.tileActive : t.tileInactive
                    }`}
                  >
                    <p
                      className={`text-label uppercase tracking-label-wide flex items-center justify-between gap-2 ${t.tileLabel}`}
                    >
                      <span>{tile.label}</span>
                      {active && <Check className="size-3" />}
                    </p>
                    <p className={`mt-1 text-micro leading-relaxed ${t.tileCaption}`}>
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
          disabled={!selectedTileId || confirming}
          size="md"
          className="w-full sm:w-auto px-8"
          onClick={onConfirm}
        >
          {confirming ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          {confirmLabel}
        </Button>
        <p
          className={`mt-3 text-micro uppercase tracking-label-xwide text-center ${tone === "dark" ? "text-surface/50" : "text-accent"}`}
        >
          {selectedTileId
            ? "Loads from our atelier library · Saved to your profile"
            : "Select a season above to confirm."}
        </p>
      </div>
    </div>
  );
}
