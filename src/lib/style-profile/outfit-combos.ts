import { NAMED_PALETTE, type Season } from "@/constants/style-profile";

export type OutfitCombo = {
  id: string;
  hexes: string[];
  names: string[];
  /** Shown in quotes under the swatch bar — one line, second person. */
  note: string;
};

/**
 * Four wearable trios drawn from the season's own named palette. Built from
 * NAMED_PALETTE rather than the dossier swatches so these names match the ones
 * the palette bands and Style DNA cards show — a combo referencing a colour the
 * member cannot find above is worse than no combo.
 *
 * ponytail: fixed recipes, not a solver. If stylists ever want per-sub-season
 * combos, this is the seam.
 */
export function combosFor(season: Season): OutfitCombo[] {
  const p = NAMED_PALETTE[season];
  if (!p || p.primary.length < 4 || p.accents.length < 2 || p.neutrals.length < 2) return [];

  const recipes = [
    {
      id: "soft",
      picks: [p.primary[0]!, p.primary[1]!, p.neutrals[0]!],
      note: "Wear this when you want something soft, polished, and low-effort.",
    },
    {
      id: "depth",
      picks: [p.primary[2]!, p.accents[0]!, p.neutrals[1]!],
      note: "A little more depth — good for meetings, dinners, and photos.",
    },
    {
      id: "weekend",
      picks: [p.primary[3]!, p.primary[0]!, p.neutrals[0]!],
      note: "Weekend palette — warm enough to feel effortless.",
    },
    {
      id: "evening",
      picks: [p.accents[1]!, p.primary[1]!, p.neutrals[1]!],
      note: "Evening leaning — refined contrast without going harsh.",
    },
  ];

  return recipes.map(({ id, picks, note }) => ({
    id,
    hexes: picks.map((s) => s.hex),
    names: picks.map((s) => s.name),
    note,
  }));
}
