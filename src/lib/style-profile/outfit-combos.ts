import type { DetailedColorProfile, Swatch } from "@/constants/style-profile";

export type OutfitCombo = {
  id: string;
  title: string;
  caption: string;
  /** Ordered largest surface first: main piece, second piece, accent. */
  colors: Swatch[];
};

/** Perceived lightness, 0–1. Same weighting the portfolio uses to pick ink. */
export function luminance(hex: string): number {
  const m = hex.replace("#", "");
  if (m.length !== 6) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Wearable three-colour outfits from the season's own swatches. The palette
 * matrix says which colours are yours; this says which of them go *together* —
 * the pairing is driven by the member's contrast scale, because a high-contrast
 * season carries black-and-ivory that would swamp a low-contrast one.
 *
 * ponytail: derived from the dossier, so no schema, no editorial table to keep
 * in sync. If stylists ever want to hand-author combos, this is the seam.
 */
export function buildOutfitCombos(profile: DetailedColorProfile): OutfitCombo[] {
  const core = [...profile.primarySwatches, ...profile.secondarySwatches];
  if (core.length < 2) return [];

  const byLight = [...core].sort((a, b) => luminance(a.hex) - luminance(b.hex));
  const darkest = byLight[0]!;
  const lightest = byLight[byLight.length - 1]!;
  const accent = (profile.accentSwatches ?? [])[0] ?? profile.secondarySwatches[0] ?? lightest;

  // Tonal pair: the two neighbours sitting closest together on the scale, so the
  // look reads as one continuous tone rather than a deliberate contrast.
  let tonal: [Swatch, Swatch] = [byLight[0]!, byLight[1]!];
  let closest = Infinity;
  for (let i = 1; i < byLight.length; i++) {
    const gap = luminance(byLight[i]!.hex) - luminance(byLight[i - 1]!.hex);
    if (gap < closest) {
      closest = gap;
      tonal = [byLight[i - 1]!, byLight[i]!];
    }
  }

  const highContrast = /high/i.test(profile.contrastScale);

  return [
    {
      id: "anchor",
      title: highContrast ? "The Full Stop" : "The Soft Anchor",
      caption: highContrast
        ? `Your contrast carries it: ${lightest.name} up top, ${darkest.name} below, ${accent.name} as the one loud note.`
        : `Keep the two ends of your palette apart with ${accent.name} between them — the break stays gentle.`,
      colors: [darkest, lightest, accent],
    },
    {
      id: "tonal",
      title: "Tonal Column",
      caption: `${tonal[0].name} into ${tonal[1].name} — one unbroken line, lengthening. Add ${accent.name} at the wrist or throat.`,
      colors: [tonal[0], tonal[1], accent],
    },
    {
      id: "statement",
      title: "Accent Forward",
      caption: `${accent.name} as the piece people see first, grounded by ${darkest.name} so it stays deliberate.`,
      colors: [accent, darkest, lightest],
    },
  ];
}
