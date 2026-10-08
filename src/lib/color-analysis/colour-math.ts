/**
 * Small colour math for her swatches: CIELAB lightness (L*, 0 black to 100
 * white) and chroma (C*ab, 0 grey upwards). Used to pick her deepest swatch as
 * a base colour and to order a palette.
 *
 * sRGB (IEC 61966-2-1) is linearised, converted to XYZ with the sRGB D65
 * matrix, then to CIELAB against the D65 reference white (no chromatic
 * adaptation). Results are rounded to 4 decimals (and -0 becomes 0) so web and
 * mobile agree to the digit on the same golden vectors.
 * // src: http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html (sRGB D65 matrix,
 * //   white 0.95047 / 1 / 1.08883) and ?Eqn_XYZ_to_Lab.html (epsilon 216/24389,
 * //   kappa 24389/27)
 *
 * Pure and dependency-free: mobile copies this file verbatim (same path).
 */

export type Lab = { l: number; a: number; b: number };

const HEX = /^#[0-9a-f]{6}$/i;

/** `#RRGGBB`, either case. */
export function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4 + 0;
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// CIE constants as exact fractions: epsilon = 216/24389, kappa = 24389/27.
function f(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
}

function unroundedLab(hex: string): Lab | null {
  if (!isHex(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  const r = linear((n >> 16) & 255);
  const g = linear((n >> 8) & 255);
  const b = linear(n & 255);
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = f(x / 0.95047);
  const fy = f(y / 1);
  const fz = f(z / 1.08883);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIELAB of a `#RRGGBB` swatch, or null when it is not one. */
export function hexToLab(hex: string): Lab | null {
  const lab = unroundedLab(hex);
  return lab ? { l: round4(lab.l), a: round4(lab.a), b: round4(lab.b) } : null;
}

/** L*: 0 is black, 100 is white. Null for an invalid hex. */
export function lightness(hex: string): number | null {
  return hexToLab(hex)?.l ?? null;
}

/** C*ab: 0 is a neutral grey; higher is more vivid. Null for an invalid hex. */
export function chroma(hex: string): number | null {
  const lab = unroundedLab(hex);
  return lab ? round4(Math.hypot(lab.a, lab.b)) : null;
}
