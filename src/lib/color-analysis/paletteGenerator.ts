import { SEASONS_DATA } from './seasonsData';
import { SeasonId } from './types';

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

const VIBES = [
  'Effortless Chic',
  'Monochromatic Depth',
  'Elevated Contrast',
  'Polished Studio Look',
  'Modern Classic',
];

// Curated name → hex map for every color referenced in SEASONS_DATA.
const COLOR_HEX: Record<string, string> = {
  // Springs
  'Baby Pink': '#F8C8D4', 'Mint Green': '#B8E6C9', 'Soft Peach': '#FBD3B4', 'Sky Blue': '#A6CFE8',
  'Warm Coral': '#F08A6E', 'Golden Yellow': '#F2C14E', 'Apricot': '#F4A672', 'Bright Teal': '#1FA6A0',
  'Bright Orange': '#F26B2A', 'Marigold': '#E8A23A', 'Lime Green': '#A8C957', 'Clear Red': '#D8362E',
  'Coral': '#E5826B', 'Bright Turquoise': '#2EB6B3', 'Sea Green': '#3CAE8B', 'Vivid Yellow': '#F4D03F',
  // Summers
  'Lavender': '#C7B8E0', 'Powder Blue': '#B8CFE3', 'Rose Pink': '#D98C9B', 'Light Grey': '#CFCDCB',
  'Periwinkle': '#8C9ED1', 'Soft Fuchsia': '#C36A93', 'Slate Blue': '#6F86A6', 'Jade Green': '#5EA68A',
  'Pigeon Blue': '#7C93B3', 'Muted Raspberry': '#A85370', 'Soft Sage': '#9AB39A', 'Mauve': '#B393A5',
  'Muted Plum': '#7E5C72', 'Slate Grey': '#7D848C', 'Soft Rose': '#D2A8AC', 'Charcoal': '#2B2B2F',
  // Autumns
  'Olive Green': '#7A7A3D', 'Beige': '#D6C3A3', 'Warm Pink': '#D38A86', 'Terracotta': '#C56A4A',
  'Pumpkin Orange': '#D6712C', 'Rich Amber': '#B27A2A', 'Moss Green': '#6E7A3A', 'Camel': '#B89265',
  'Rust': '#A0451E', 'Deep Olive': '#4F5A2A', 'Burnt Orange': '#B8501F', 'Teal Blue': '#2D6E78',
  'Burgundy': '#6E1E2E', 'Deep Forest Green': '#234734', 'Dark Chocolate': '#3B2618', 'Mustard': '#C99A2E',
  // Winters
  'Royal Blue': '#2747B0', 'Fuchsia': '#C8157A', 'Pure White': '#FAFAFA',
  'Emerald Green': '#1E8A5A', 'Sapphire Blue': '#1F3F8A', 'True Violet': '#6A2E9C', 'Magenta': '#C12F86',
  'Electric Blue': '#1B5FE3', 'Shocking Pink': '#E5337A', 'Pure Crimson': '#C7142A', 'Stark Black': '#0E0E10',
  'Navy Blue': '#1B2A4E', 'Deep Emerald': '#114F38', 'True Burgundy': '#5E1424', 'Pure Black': '#0A0A0A',
};

const FAMILY_FALLBACK_HEX: Record<string, string[]> = {
  Spring: ['#F4C28A', '#E5826B', '#F2C14E'],
  Summer: ['#B8CFE3', '#D98C9B', '#7E5C72'],
  Autumn: ['#C56A4A', '#B89265', '#4F5A2A'],
  Winter: ['#1B2A4E', '#C12F86', '#0E0E10'],
};

const MILA_TAKES = [
  'A grounded base with one signature lift — easy to wear all day.',
  'Soft tonal flow with a confident accent. Polished, never loud.',
  'Strong contrast pulled straight from your palette — sharp and on brand.',
  'A relaxed warm mix that photographs beautifully in daylight.',
  'Quiet neutrals up top, a single moment of color to finish.',
  'Modern, low-effort balance — built for an unscripted day.',
];

// Curated Spring Soft / PCCS Light & Soft palette combinations.
const CURATED_MIXES: Array<{
  base: { name: string; hex: string };
  statement: { name: string; hex: string };
  accent: { name: string; hex: string };
  vibe: string;
}> = [
  {
    base: { name: 'Warm Peach Blush', hex: '#F4C9B0' },
    statement: { name: 'Buttermilk Ivory', hex: '#F4E9D1' },
    accent: { name: 'Dusty Rose', hex: '#D8A8A8' },
    vibe: 'Effortless Chic',
  },
  {
    base: { name: 'Sage Mist', hex: '#C2D1B8' },
    statement: { name: 'Bone Ecru', hex: '#EDE3D1' },
    accent: { name: 'Soft Coral', hex: '#EFA48A' },
    vibe: 'Garden Light',
  },
  {
    base: { name: 'Lavender Cream', hex: '#D9CCE3' },
    statement: { name: 'Warm White', hex: '#F7F1E8' },
    accent: { name: 'Blush Mauve', hex: '#C99AAB' },
    vibe: 'Quiet Romance',
  },
  {
    base: { name: 'Champagne', hex: '#E8D5B0' },
    statement: { name: 'Soft Pistachio', hex: '#CFDDB4' },
    accent: { name: 'Rose Clay', hex: '#C9897C' },
    vibe: 'Modern Classic',
  },
  {
    base: { name: 'Charcoal', hex: '#2B2B2F' },
    statement: { name: 'Soft Blue', hex: '#7C93B3' },
    accent: { name: 'Rose Pink', hex: '#D98C9B' },
    vibe: 'Elevated Contrast',
  },
];

let lastMixIndex = -1;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function hexFor(name: string, family: string, idx: number): string {
  const fallback = FAMILY_FALLBACK_HEX[family] ?? FAMILY_FALLBACK_HEX.Summer;
  return COLOR_HEX[name] ?? (fallback[idx % fallback.length] as string);
}

export function generateDailyPalette(userSeasonId: SeasonId): DailyPalette {
  void userSeasonId;
  void hexFor;
  void VIBES;

  // Rotate through curated mixes, ensuring we don't repeat the previous one.
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