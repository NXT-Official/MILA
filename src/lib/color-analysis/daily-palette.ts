import { chroma, isHex, lightness } from "./colour-math";
import type { DailyPalette } from "./paletteGenerator";

/**
 * Today's palette from her own colours (Wave D, D-W9): three of her swatches
 * with an explicit wear map. The deepest of the three is the base (bottoms or
 * a jacket), the more vivid of the other two is the statement (top, near the
 * face) and the last is the accent (shoes, bag, jewelry). The pick is seeded,
 * so one member on one day at one attempt always gets the same palette, and it
 * skips her last few trios so a shuffle never repeats one.
 *
 * Pure, zod-free, relative imports only: mobile copies this file verbatim.
 * // src: FNV-1a 32-bit (offset 2166136261, prime 16777619) and mulberry32,
 * //   https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */

export type PaletteSwatch = { name: string; hex: string };
export type WearRole = "base" | "statement" | "accent";

export const RECENT_TRIOS = 5;
export const DAILY_VIBE = "From your colors";

export const WEAR_LINES: Record<WearRole, string> = {
  base: "Bottoms or a jacket",
  statement: "Top, near your face",
  accent: "Shoes, bag or jewelry",
};

/** FNV-1a, 32-bit. */
function fnv1a(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `{userId}:{localDate}:{attempt}`, the string the pick is seeded from. */
export function paletteSeed(userId: string, dateKey: string, attempt: number): string {
  return `${userId}:${dateKey}:${attempt}`;
}

/** The member's local calendar day, `YYYY-MM-DD`. */
export function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The same key for the same three colours in any order. */
export function trioKey(hexes: readonly string[]): string {
  return hexes
    .map((hex) => hex.toUpperCase())
    .sort()
    .join("|");
}

/** Appends `key` (moving it to the end if present) and keeps the newest `max`. */
export function pushRecent(recent: readonly string[], key: string, max: number): string[] {
  return [...recent.filter((k) => k !== key), key].slice(-max);
}

type Trio = readonly [PaletteSwatch, PaletteSwatch, PaletteSwatch];

function assign(trio: Trio): {
  base: PaletteSwatch;
  statement: PaletteSwatch;
  accent: PaletteSwatch;
} {
  const [base, first, second] = [...trio].sort(
    (x, y) => (lightness(x.hex) ?? 0) - (lightness(y.hex) ?? 0),
  ) as [PaletteSwatch, PaletteSwatch, PaletteSwatch];
  const vivid = (chroma(second.hex) ?? 0) > (chroma(first.hex) ?? 0);
  return vivid
    ? { base, statement: second, accent: first }
    : { base, statement: first, accent: second };
}

function toPalette(trio: Trio): DailyPalette {
  const { base, statement, accent } = assign(trio);
  return {
    baseColor: base.name,
    statementColor: statement.name,
    accentColor: accent.name,
    baseHex: base.hex,
    statementHex: statement.hex,
    accentHex: accent.hex,
    isSisterSeasonIncluded: false,
    styleVibe: DAILY_VIBE,
    insight: `Wear ${base.name} on your bottoms or a jacket, ${statement.name} on top near your face, and ${accent.name} on your shoes, bag or jewelry.`,
    source: "swatches",
  };
}

/** Valid `#RRGGBB` only, each colour once (case-insensitive), in the order given. */
function usable(swatches: readonly PaletteSwatch[]): PaletteSwatch[] {
  const seen = new Set<string>();
  return swatches.filter((swatch) => {
    if (!isHex(swatch.hex)) return false;
    const hex = swatch.hex.toUpperCase();
    if (seen.has(hex)) return false;
    seen.add(hex);
    return true;
  });
}

function trios(given: readonly PaletteSwatch[]): Trio[] {
  const swatches = usable(given);
  const all: Trio[] = [];
  for (let i = 0; i < swatches.length; i += 1) {
    for (let j = i + 1; j < swatches.length; j += 1) {
      for (let k = j + 1; k < swatches.length; k += 1) {
        all.push([swatches[i]!, swatches[j]!, swatches[k]!]);
      }
    }
  }
  return all;
}

function keyOf(trio: Trio): string {
  return trioKey(trio.map((s) => s.hex));
}

/**
 * Null with fewer than three swatches. Skips every trio in `recent`; if that
 * leaves nothing (she has very few swatches), it forgets the newest recent
 * keys one at a time until something is left, so the least recently shown
 * trio comes back first.
 */
export function buildDailyPalette(input: {
  swatches: readonly PaletteSwatch[];
  seed: string;
  recent: readonly string[];
}): DailyPalette | null {
  const all = trios(input.swatches);
  if (all.length === 0) return null;
  let pool: Trio[] = [];
  for (let skip = 0; skip <= input.recent.length && pool.length === 0; skip += 1) {
    const blocked = new Set(input.recent.slice(skip));
    pool = all.filter((trio) => !blocked.has(keyOf(trio)));
  }
  const at = Math.floor(mulberry32(fnv1a(input.seed))() * pool.length);
  return toPalette(pool[Math.min(at, pool.length - 1)]!);
}

/** The palette for a trio she was already shown, or null once it is no longer all hers. */
export function paletteForKey(input: {
  swatches: readonly PaletteSwatch[];
  key: string;
}): DailyPalette | null {
  const found = trios(input.swatches).find((trio) => keyOf(trio) === input.key);
  return found ? toPalette(found) : null;
}
