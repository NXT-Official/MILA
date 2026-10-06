import type { SeasonProfile } from "./types";

export interface DailyPalette {
  baseColor: string;
  statementColor: string;
  accentColor: string;
  baseHex: string;
  statementHex: string;
  accentHex: string;
  isSisterSeasonIncluded: boolean;
  styleVibe: string;
  insight: string;
}

type SeasonFamily = SeasonProfile["family"];

interface CuratedMix {
  base: { name: string; hex: string };
  statement: { name: string; hex: string };
  accent: { name: string; hex: string };
  vibe: string;
  insight: string;
  /** The season families this mix flatters. */
  families: readonly SeasonFamily[];
}

const CURATED_MIXES: readonly CuratedMix[] = [
  {
    base: { name: "Warm Peach Blush", hex: "#F4C9B0" },
    statement: { name: "Buttermilk Ivory", hex: "#F4E9D1" },
    accent: { name: "Dusty Rose", hex: "#D8A8A8" },
    vibe: "Effortless Chic",
    insight: "Soft tonal flow with a confident accent. Polished, never loud.",
    families: ["Spring", "Autumn"],
  },
  {
    base: { name: "Sage Mist", hex: "#C2D1B8" },
    statement: { name: "Bone Ecru", hex: "#EDE3D1" },
    accent: { name: "Soft Coral", hex: "#EFA48A" },
    vibe: "Garden Light",
    insight: "A relaxed warm mix that photographs beautifully in daylight.",
    families: ["Spring", "Autumn"],
  },
  {
    base: { name: "Lavender Cream", hex: "#D9CCE3" },
    statement: { name: "Warm White", hex: "#F7F1E8" },
    accent: { name: "Blush Mauve", hex: "#C99AAB" },
    vibe: "Quiet Romance",
    insight: "Quiet neutrals up top, a single moment of color to finish.",
    families: ["Summer"],
  },
  {
    base: { name: "Champagne", hex: "#E8D5B0" },
    statement: { name: "Soft Pistachio", hex: "#CFDDB4" },
    accent: { name: "Rose Clay", hex: "#C9897C" },
    vibe: "Modern Classic",
    insight: "Modern, low-effort balance — built for an unscripted day.",
    families: ["Spring", "Autumn"],
  },
  {
    base: { name: "Charcoal", hex: "#2B2B2F" },
    statement: { name: "Soft Blue", hex: "#7C93B3" },
    accent: { name: "Rose Pink", hex: "#D98C9B" },
    vibe: "Elevated Contrast",
    insight: "Strong contrast, sharp and easy to wear.",
    families: ["Summer", "Winter"],
  },
  {
    base: { name: "Midnight Navy", hex: "#1F2A44" },
    statement: { name: "Crisp White", hex: "#F5F7FA" },
    accent: { name: "Fuchsia", hex: "#C2185B" },
    vibe: "Sharp Contrast",
    insight: "A grounded base with one signature lift — easy to wear all day.",
    families: ["Winter"],
  },
  {
    base: { name: "Deep Emerald", hex: "#0B5D4B" },
    statement: { name: "Pure White", hex: "#FAFAFC" },
    accent: { name: "Cobalt Blue", hex: "#2F4FC4" },
    vibe: "Jewel Tone",
    insight: "Rich jewel color, kept clean with crisp white.",
    families: ["Winter"],
  },
  {
    base: { name: "Warm Olive", hex: "#6B6B3A" },
    statement: { name: "Cream", hex: "#F1E6CF" },
    accent: { name: "Burnt Terracotta", hex: "#B5573A" },
    vibe: "Earth Tones",
    insight: "Warm, grounded earth tones — easy to layer, easy to wear.",
    families: ["Autumn"],
  },
];

/**
 * The stored season is free text — a sub-season name ("Soft Autumn"), a full
 * profile label ("Winter Deep / Dark Winter"), an id ("cool_summer") or a bare
 * family ("Spring") — so match on the family word wherever it sits.
 *
 * No lookbehind: Safari before 16.4 can't parse one, and a SyntaxError would
 * take the whole dashboard chunk down. The leading group consumes the
 * character before the word, which shifts a match's position by one but can't
 * reorder two families, so "the family named first wins" still holds.
 */
const FAMILY_WORDS: ReadonlyArray<{ pattern: RegExp; family: SeasonFamily }> = [
  { pattern: /(?:^|[^a-z])spring(?![a-z])/i, family: "Spring" },
  { pattern: /(?:^|[^a-z])summer(?![a-z])/i, family: "Summer" },
  { pattern: /(?:^|[^a-z])(?:autumn|fall)(?![a-z])/i, family: "Autumn" },
  { pattern: /(?:^|[^a-z])winter(?![a-z])/i, family: "Winter" },
];

function seasonFamilyOf(season: string | null | undefined): SeasonFamily | null {
  if (!season) return null;
  let found: { family: SeasonFamily; at: number } | null = null;
  for (const { pattern, family } of FAMILY_WORDS) {
    const at = season.search(pattern);
    if (at !== -1 && (!found || at < found.at)) found = { family, at };
  }
  return found?.family ?? null;
}

function sameMix(
  mix: CuratedMix,
  palette: Pick<DailyPalette, "baseHex" | "statementHex" | "accentHex">,
) {
  return (
    mix.base.hex === palette.baseHex &&
    mix.statement.hex === palette.statementHex &&
    mix.accent.hex === palette.accentHex
  );
}

/**
 * Picks a mix that suits the member's season family. With no readable season,
 * or no mix tagged for it, it draws from the whole set and says nothing about
 * her palette. `previous` is the mix on screen: it is skipped whenever another
 * candidate exists, so a shuffle always changes something.
 */
export function generateDailyPalette(
  userSeason: string | null | undefined,
  previous: Pick<DailyPalette, "baseHex" | "statementHex" | "accentHex"> | null = null,
  random: () => number = Math.random,
): DailyPalette {
  const family = seasonFamilyOf(userSeason);
  const suited = family ? CURATED_MIXES.filter((m) => m.families.includes(family)) : [];
  const matched = suited.length > 0;
  const candidates = matched ? suited : CURATED_MIXES;
  const fresh = previous ? candidates.filter((m) => !sameMix(m, previous)) : candidates;
  const pool = fresh.length > 0 ? fresh : candidates;
  const mix = pool[Math.min(Math.floor(random() * pool.length), pool.length - 1)]!;

  return {
    baseColor: mix.base.name,
    statementColor: mix.statement.name,
    accentColor: mix.accent.name,
    baseHex: mix.base.hex,
    statementHex: mix.statement.hex,
    accentHex: mix.accent.hex,
    isSisterSeasonIncluded: false,
    styleVibe: mix.vibe,
    insight: matched && family ? `${mix.insight} Picked for your ${family} palette.` : mix.insight,
  };
}
