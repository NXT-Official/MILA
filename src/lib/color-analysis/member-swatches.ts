import { isHex } from "./colour-math";

/**
 * Her own wearable colours, read from `profiles.color_profile`: the primary
 * swatches, then the secondary ones. These are the only names the look plan
 * may choose a `wear_colour` from, and the hex is always copied from here,
 * never from the model (Wave D plan, section 3.6).
 *
 * Reads both stored shapes: the AI dossier (`primarySwatches`,
 * `secondarySwatches`) and the v2 quiz profile (`primary`, `secondary`).
 * Accent swatches are not wearable base colours and are not read. An empty
 * current list falls back to the v2 list. Names are capped at 40 characters:
 * `color_profile` is member-writable, and these names go into a tool enum and
 * the prompt.
 *
 * Pure and dependency-free: mobile copies this file verbatim (same path).
 */

export type MemberSwatch = { name: string; hex: string };

export const MAX_MEMBER_SWATCHES = 8;
export const MAX_SWATCH_NAME_LENGTH = 40;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list(profile: Record<string, unknown>, current: string, v2: string): unknown[] {
  const primary = profile[current];
  if (Array.isArray(primary) && primary.length > 0) return primary;
  const fallback = profile[v2];
  return Array.isArray(fallback) ? fallback : [];
}

/**
 * Primary then secondary, each name and each hex once (case-insensitive), at
 * most 8, each name at most 40 characters.
 */
export function memberSwatches(colorProfile: unknown): MemberSwatch[] {
  const profile = record(colorProfile);
  if (!profile) return [];
  const candidates = [
    ...list(profile, "primarySwatches", "primary"),
    ...list(profile, "secondarySwatches", "secondary"),
  ];
  const seenNames = new Set<string>();
  const seenHexes = new Set<string>();
  const swatches: MemberSwatch[] = [];
  for (const candidate of candidates) {
    if (swatches.length >= MAX_MEMBER_SWATCHES) break;
    const swatch = record(candidate);
    const rawName = swatch?.name;
    const rawHex = swatch?.hex;
    const name =
      typeof rawName === "string" ? rawName.trim().slice(0, MAX_SWATCH_NAME_LENGTH).trim() : "";
    const hex = isHex(rawHex) ? rawHex.toUpperCase() : null;
    if (!name || !hex) continue;
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey) || seenHexes.has(hex)) continue;
    seenNames.add(nameKey);
    seenHexes.add(hex);
    swatches.push({ name, hex });
  }
  return swatches;
}
