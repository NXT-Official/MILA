import { isHex, lightness } from "./color-analysis/colour-math";
import { MAX_SWATCH_NAME_LENGTH, type MemberSwatch } from "./color-analysis/member-swatches";
import { GARMENT_KIND_ORDER, garmentFor, productName, type GarmentKind } from "./garment-label";

/**
 * Her colour map: which of her own colours to wear each piece of a look in
 * (Wave D plan, section 3.6, ruling R6).
 *
 * The look plan's tool may only name one of her swatches (an enum of
 * `memberSwatches` names) and a role. The hex is always copied from her own
 * swatch here, never taken from the model, and a name she does not have gives
 * no colour at all. We never claim a product's own colour: the map says which
 * of her colours to choose the piece in.
 *
 * Wear map: base colours go on bottoms and outer layers, the statement colour
 * on the top (near the face), accent colours on shoes, bags and jewelry.
 *
 * Pure and dependency-free apart from colour-math, member-swatches and
 * garment-label: mobile copies this file verbatim (same path, D-M4). Copy
 * (role words, panel lines) lives in each app's components, because the two
 * apps spell "colour" and "jewelry" differently.
 */

export const WEAR_ROLES = ["base", "statement", "accent"] as const;

export type WearRole = (typeof WEAR_ROLES)[number];

/** One piece's colour: her swatch's own name and hex, and its role in the look. */
export type WearColour = { name: string; hex: string; role: WearRole };

/** The fields of a shoppable pick the colour map reads. */
export type ColourMapPick = {
  id: string;
  title: string;
  category: string;
  rationale?: string | null;
  /** "similar" picks are shelf extras, not pieces of the look: never mapped. */
  source?: string | null;
  /** Read back through asWearColour: a recovered look arrives unchecked. */
  wear_colour?: unknown;
};

export type ColourMapRow = {
  id: string;
  kind: GarmentKind;
  /** The garment's plain name ("Jeans"), from garmentFor. */
  label: string;
  /** The product's own name, without the "| Colour | Size" tail. */
  title: string;
  /** Null: no colour was picked for this piece. */
  wear: WearColour | null;
  /** The first sentence of the pick's rationale, at most 140 characters. */
  reason: string;
};

/** What a saved look keeps (D-W8): no prices, no links, no reasons. */
export type SavedColourMapRow = Pick<ColourMapRow, "kind" | "label" | "title" | "wear">;

export const MAX_SAVED_COLOUR_MAP_ROWS = 12;

export const REASON_MAX_LENGTH = 140;

const ROLE_SET: ReadonlySet<string> = new Set(WEAR_ROLES);

const DEFAULT_ROLES: Readonly<Record<GarmentKind, WearRole>> = {
  top: "statement",
  dress: "statement",
  bottoms: "base",
  outerwear: "base",
  shoes: "accent",
  bag: "accent",
  jewelry: "accent",
  accessory: "accent",
  // A piece no shelf names is treated as a small finishing piece.
  unknown: "accent",
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isWearRole(value: unknown): value is WearRole {
  return typeof value === "string" && ROLE_SET.has(value);
}

/** Where the piece sits in her look, by the kind garmentFor gives it. */
export function defaultRoleFor(kind: GarmentKind): WearRole {
  return DEFAULT_ROLES[kind] ?? "accent";
}

/**
 * A wear colour read back from anywhere we did not just build it (a stored
 * job result, a saved look, a client echo): kept only when it is whole, its
 * name fits a swatch name, its hex is `#RRGGBB` and its role is one of
 * WEAR_ROLES. The hex is returned upper-case, so it is safe to paint with.
 */
export function asWearColour(value: unknown): WearColour | null {
  const raw = record(value);
  if (!raw) return null;
  const name = text(raw.name).trim();
  if (!name || name.length > MAX_SWATCH_NAME_LENGTH) return null;
  if (!isHex(raw.hex) || !isWearRole(raw.role)) return null;
  return { name, hex: raw.hex.toUpperCase(), role: raw.role };
}

/**
 * The model's `wear_colour: { swatch, role }` for one pick, joined back to her
 * own swatches. The name and hex are hers; only the role is the model's. An
 * unknown swatch name, an unknown role, or anything malformed gives null.
 */
export function hydrateWearColour(
  raw: unknown,
  swatches: readonly MemberSwatch[],
): WearColour | null {
  const pick = record(raw);
  if (!pick || !isWearRole(pick.role)) return null;
  const wanted = text(pick.swatch);
  const key = wanted.trim().toLowerCase();
  if (!key) return null;
  const swatch =
    swatches.find((candidate) => candidate.name === wanted) ??
    swatches.find((candidate) => candidate.name.trim().toLowerCase() === key);
  if (!swatch) return null;
  return asWearColour({ name: swatch.name, hex: swatch.hex, role: pick.role });
}

/**
 * The colour for a piece the model did not plan (the weather backfill): her
 * deepest swatch (lowest CIE L*), in the role the piece's kind gives it. The
 * first swatch wins a tie. Null when she has no usable swatch.
 */
export function fallbackWearColour(
  kind: GarmentKind,
  swatches: readonly MemberSwatch[],
): WearColour | null {
  let deepest: { swatch: MemberSwatch; l: number } | null = null;
  for (const swatch of swatches) {
    const l = lightness(swatch.hex);
    if (l === null) continue;
    if (!deepest || l < deepest.l) deepest = { swatch, l };
  }
  if (!deepest) return null;
  return asWearColour({
    name: deepest.swatch.name,
    hex: deepest.swatch.hex,
    role: defaultRoleFor(kind),
  });
}

/**
 * Member-facing copy never shows an em or en dash (nor a figure dash or
 * horizontal bar). Between digits the dash becomes a plain hyphen ("55-75°F");
 * anywhere else it becomes a comma, and a comma it leaves before other
 * punctuation, or at either end, is dropped.
 */
function withoutDashes(value: string): string {
  return value
    .replace(/(\d)\s*[\u2012-\u2015]+\s*(?=\d)/g, "$1-")
    .replace(/\s*[\u2012-\u2015]+\s*/g, ", ")
    .replace(/(?:,\s*)+(?=[,.!?;:]|$)/g, "")
    .replace(/^\s*,\s*/, "")
    .replace(/,(?:\s*,)+/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The first sentence of a text, at most `max` characters, with no em or en
 * dash (see withoutDashes). A sentence ends at ".", "!" or "?" followed by a
 * capital, a digit or the end, so "e.g. a camp collar" carries on. A longer
 * sentence is cut at a word and ends with "…".
 */
export function firstSentence(value: string, max: number = REASON_MAX_LENGTH): string {
  const clean = withoutDashes(text(value).replace(/\s+/g, " ").trim());
  if (!clean) return "";
  const end = /[.!?](?=\s+["'“‘(]?[A-Z0-9]|$)/.exec(clean);
  const sentence = end ? clean.slice(0, end.index + 1) : clean;
  if (sentence.length <= max) return sentence;
  const room = sentence.slice(0, Math.max(1, max - 1));
  const lastSpace = room.lastIndexOf(" ");
  const cut = lastSpace > max / 2 ? room.slice(0, lastSpace) : room;
  return `${cut.replace(/[\s,;:.!?-]+$/, "")}…`;
}

function kindOrder(kind: GarmentKind): number {
  const index = GARMENT_KIND_ORDER.indexOf(kind);
  return index === -1 ? GARMENT_KIND_ORDER.length : index;
}

/**
 * One row per planned piece of the look, head to toe (GARMENT_KIND_ORDER),
 * keeping the plan's order within a kind. "similar" shelf extras are skipped.
 */
export function colourMapRows(picks: readonly ColourMapPick[]): ColourMapRow[] {
  return picks
    .filter((pick) => pick.source !== "similar")
    .map((pick, index) => {
      const title = text(pick.title);
      const garment = garmentFor(text(pick.category), title);
      const row: ColourMapRow = {
        id: text(pick.id),
        kind: garment.kind,
        label: garment.label,
        title: productName(title),
        wear: asWearColour(pick.wear_colour),
        reason: firstSentence(text(pick.rationale)),
      };
      return { row, index };
    })
    .sort((a, b) => kindOrder(a.row.kind) - kindOrder(b.row.kind) || a.index - b.index)
    .map(({ row }) => row);
}

/**
 * The compact map a saved look keeps (D-W8): kind, label, title and colour
 * per planned piece, head to toe, at most 12 rows. Empty when no piece has a
 * colour, so a look from before colour maps saves nothing extra.
 */
export function toSavedColourMap(picks: readonly ColourMapPick[]): SavedColourMapRow[] {
  const rows = colourMapRows(picks);
  if (!rows.some((row) => row.wear !== null)) return [];
  return rows
    .slice(0, MAX_SAVED_COLOUR_MAP_ROWS)
    .map(({ kind, label, title, wear }) => ({ kind, label, title, wear }));
}
