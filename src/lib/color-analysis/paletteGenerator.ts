import { SeasonId } from "./types";

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

const MILA_TAKES = [
  "A grounded base with one signature lift — easy to wear all day.",
  "Soft tonal flow with a confident accent. Polished, never loud.",
  "Strong contrast pulled straight from your palette — sharp and on brand.",
  "A relaxed warm mix that photographs beautifully in daylight.",
  "Quiet neutrals up top, a single moment of color to finish.",
  "Modern, low-effort balance — built for an unscripted day.",
];

const CURATED_MIXES: Array<{
  base: { name: string; hex: string };
  statement: { name: string; hex: string };
  accent: { name: string; hex: string };
  vibe: string;
}> = [
  {
    base: { name: "Warm Peach Blush", hex: "#F4C9B0" },
    statement: { name: "Buttermilk Ivory", hex: "#F4E9D1" },
    accent: { name: "Dusty Rose", hex: "#D8A8A8" },
    vibe: "Effortless Chic",
  },
  {
    base: { name: "Sage Mist", hex: "#C2D1B8" },
    statement: { name: "Bone Ecru", hex: "#EDE3D1" },
    accent: { name: "Soft Coral", hex: "#EFA48A" },
    vibe: "Garden Light",
  },
  {
    base: { name: "Lavender Cream", hex: "#D9CCE3" },
    statement: { name: "Warm White", hex: "#F7F1E8" },
    accent: { name: "Blush Mauve", hex: "#C99AAB" },
    vibe: "Quiet Romance",
  },
  {
    base: { name: "Champagne", hex: "#E8D5B0" },
    statement: { name: "Soft Pistachio", hex: "#CFDDB4" },
    accent: { name: "Rose Clay", hex: "#C9897C" },
    vibe: "Modern Classic",
  },
  {
    base: { name: "Charcoal", hex: "#2B2B2F" },
    statement: { name: "Soft Blue", hex: "#7C93B3" },
    accent: { name: "Rose Pink", hex: "#D98C9B" },
    vibe: "Elevated Contrast",
  },
];

let lastMixIndex = -1;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

export function generateDailyPalette(userSeasonId: SeasonId): DailyPalette {
  void userSeasonId;

  let nextIndex = Math.floor(Math.random() * CURATED_MIXES.length);
  if (CURATED_MIXES.length > 1 && nextIndex === lastMixIndex) {
    nextIndex = (nextIndex + 1) % CURATED_MIXES.length;
  }
  lastMixIndex = nextIndex;
  const mix = CURATED_MIXES[nextIndex]!;

  return {
    baseColor: mix.base.name,
    statementColor: mix.statement.name,
    accentColor: mix.accent.name,
    baseHex: mix.base.hex,
    statementHex: mix.statement.hex,
    accentHex: mix.accent.hex,
    isSisterSeasonIncluded: false,
    styleVibe: mix.vibe,
    insight: pick(MILA_TAKES),
  };
}
