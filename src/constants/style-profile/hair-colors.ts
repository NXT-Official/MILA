import type { MatrixOption } from "./types";

/**
 * Her hair colour, as stored in `profiles.hair_color` (Wave D, migration
 * 20261008090000_quick_rescan_hair_colour.sql). The database only guards the
 * size (1 to 40 characters); this list is the real validation, on every read
 * and every write.
 *
 * Shared verbatim with mobile (same path). The stored values and the
 * descriptions avoid the word "colour"/"color", so both apps store and show
 * the same text whichever spelling each app uses. Adding a value is safe;
 * renaming or removing one strands members who already chose it.
 */
export const HAIR_COLORS = [
  "Black",
  "Dark brown",
  "Medium brown",
  "Light brown",
  "Auburn",
  "Red",
  "Golden blonde",
  "Ash blonde",
  "Platinum blonde",
  "Grey or silver",
  "White",
  "Vivid dyed shade",
] as const;

export type HairColor = (typeof HAIR_COLORS)[number];

const HAIR_COLOR_SET: ReadonlySet<string> = new Set(HAIR_COLORS);

/** Exactly one of HAIR_COLORS (no trimming, no case folding). */
export function isHairColor(value: unknown): value is HairColor {
  return typeof value === "string" && HAIR_COLOR_SET.has(value);
}

const DESCRIPTIONS: Record<HairColor, string> = {
  Black: "Deep, true black, including blue black.",
  "Dark brown": "Rich brown that can read almost black indoors.",
  "Medium brown": "Classic brown, neither very light nor very dark.",
  "Light brown": "Soft brown with lighter, sunlit tones.",
  Auburn: "Brown with a warm red glow.",
  Red: "Copper, ginger or true red.",
  "Golden blonde": "Warm blonde with honey or golden tones.",
  "Ash blonde": "Cool blonde with a smoky, beige or grey cast.",
  "Platinum blonde": "Very pale, icy blonde.",
  "Grey or silver": "Natural grey, salt and pepper, or silver.",
  White: "Bright white or snowy hair.",
  "Vivid dyed shade": "Pink, blue, purple or any other bold dyed shade.",
};

export const HAIR_COLOR_OPTIONS: MatrixOption[] = HAIR_COLORS.map((value) => ({
  value,
  title: value,
  description: DESCRIPTIONS[value],
}));
