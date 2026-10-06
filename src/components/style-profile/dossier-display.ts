/**
 * Display helpers for the style dossier. Every label and swatch here is read
 * from the value it sits next to (a swatch's hex, a fabric's or a colour's
 * name) — never from its position in a list — so a pale mint can't be called
 * a "midnight anchor" and a bleached denim can't wear a navy swatch.
 */
import type { Swatch } from "@/constants/style-profile";

/** The red, green and blue channels of a `#RRGGBB` colour, or null if it isn't one. */
function rgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Perceived lightness (CIE L*) of a `#RRGGBB` colour: 0 is black, 100 is white. */
export function swatchLightness(hex: string): number | null {
  const channels = rgb(hex);
  if (!channels) return null;
  const [r, g, b] = channels.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/** The role printed under a core tone, from how light the swatch actually is. */
export function toneRole(hex: string): string {
  const lightness = swatchLightness(hex);
  if (lightness === null) return "Signature Tone";
  if (lightness >= 75) return "Light Tone";
  if (lightness >= 45) return "Mid Tone";
  return "Deep Tone";
}

/** How colourful a `#RRGGBB` swatch is: the spread between its strongest and weakest channel. */
function chroma(hex: string): number {
  const channels = rgb(hex);
  return channels ? Math.max(...channels) - Math.min(...channels) : 0;
}

/**
 * The `count` most colourful swatches, keeping palette order on a tie. Used
 * for accents, so a pale ivory never ends up as an "accent" that vanishes
 * against the card.
 */
export function mostVivid(swatches: Swatch[], count: number): Swatch[] {
  return swatches
    .map((swatch, index) => ({ swatch, index, chroma: chroma(swatch.hex) }))
    .sort((a, b) => b.chroma - a.chroma || a.index - b.index)
    .slice(0, count)
    .map(({ swatch }) => swatch);
}

/** First match wins, so the more specific fibre comes before the general one. */
const FABRIC_FEELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/chiffon|organza|voile|sheer/, "Sheer & Airy"],
  [/linen/, "Light & Breathable"],
  [/cashmere|merino|shearling/, "Soft & Warm"],
  [/knit/, "Soft & Textured"],
  [/silk|satin/, "Natural Sheen"],
  [/velvet|brocade|cord/, "Rich & Textured"],
  [/suede/, "Soft & Matte"],
  [/leather|latex|neoprene/, "Holds Its Shape"],
  [/brushed/, "Soft & Brushed"],
  [/wool|tweed|flannel|twill/, "Tailored & Dense"],
  [/canvas/, "Sturdy & Matte"],
  [/poplin|cotton/, "Crisp & Matte"],
];

/** How a fabric drapes, from its name. Null when the fabric isn't one we know. */
export function fabricFeel(material: string): string | null {
  const name = material.toLowerCase();
  return FABRIC_FEELS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export type DenimShade = { swatch: string; finish: string };

/** First match wins: black and white before any blue, a named tint before the wash depth. */
const DENIM_SHADES: ReadonlyArray<readonly [RegExp, DenimShade]> = [
  [/black/, { swatch: "#1E1E24", finish: "Black wash" }],
  [/white/, { swatch: "#F2F0EA", finish: "White denim" }],
  [/ecru|bone|cream/, { swatch: "#E6E1D3", finish: "Undyed ecru" }],
  [/(dark|deep|charcoal).*gr[ae]y/, { swatch: "#4A4E55", finish: "Dark gray wash" }],
  [/(light|pale|soft).*gr[ae]y/, { swatch: "#C9CCD0", finish: "Light gray wash" }],
  [/gr[ae]y/, { swatch: "#9A9EA4", finish: "Gray wash" }],
  [/(dark|deep).*indigo|indigo.*(raw|selvedge)/, { swatch: "#1F2A44", finish: "Dark wash" }],
  [/indigo/, { swatch: "#2E4470", finish: "Indigo wash" }],
  [/espresso/, { swatch: "#4A3328", finish: "Warm tinted wash" }],
  [/khaki/, { swatch: "#B5A47E", finish: "Warm tinted wash" }],
  [/rust|russet/, { swatch: "#9A5B3C", finish: "Warm tinted wash" }],
  [/tobacco|brown/, { swatch: "#7A5A3E", finish: "Warm tinted wash" }],
  [/periwinkle/, { swatch: "#8F9FD6", finish: "Tinted wash" }],
  [/bleached|light|pale|icy|sky/, { swatch: "#A9C3DD", finish: "Light wash" }],
  [/dark|deep|raw|inky|selvedge/, { swatch: "#1F2A44", finish: "Dark wash" }],
];

const MID_DENIM: DenimShade = { swatch: "#5B7A9E", finish: "Mid wash" };

/** The swatch and finish line for a denim wash, from its name. */
export function denimShade(wash: string): DenimShade {
  const name = wash.toLowerCase();
  return DENIM_SHADES.find(([pattern]) => pattern.test(name))?.[1] ?? MID_DENIM;
}

/** First match wins: "burnt orange" before "orange", "magenta" before "pink". */
const AVOID_SWATCHES: ReadonlyArray<readonly [RegExp, string]> = [
  [/black/, "#0B0B0F"],
  [/white/, "#F4F4F0"],
  [/neon|fluorescent/, "#39FF14"],
  [/vivid primar|primaries/, "#D72638"],
  [/orange-red/, "#E8452C"],
  [/magenta|fuchsia/, "#B23A7A"],
  [/chartreuse/, "#B6C24A"],
  [/mustard/, "#C9A227"],
  [/golden yellow|gold/, "#E0B23A"],
  [/rust/, "#9C4A2A"],
  [/burnt orange/, "#C25A1C"],
  [/pastel orange/, "#F8C79E"],
  [/peach/, "#F9D3BE"],
  [/orange/, "#D97A3A"],
  [/pink/, "#F3C6D6"],
  [/mint/, "#BFE8D2"],
  [/powder blue/, "#B9D3EA"],
  [/slate blue/, "#6A7F99"],
  [/blue/, "#BFDDF2"],
  [/olive/, "#6B6B2E"],
  [/mauve/, "#8A6F7A"],
  [/gr[ae]y|smok/, "#9A9A9E"],
  [/beige|camel|\btan\b/, "#C8B08E"],
  [/brown/, "#6B4A3A"],
  [/muted|dusty|washed-out|hazy/, "#A89F9B"],
];

/** The swatch beside a colour to avoid, from its name. Null when the name isn't one we know. */
export function avoidSwatchHex(name: string): string | null {
  const lower = name.toLowerCase();
  return AVOID_SWATCHES.find(([pattern]) => pattern.test(lower))?.[1] ?? null;
}
