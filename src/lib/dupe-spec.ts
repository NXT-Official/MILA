import { z } from "zod";
import { ClothingAttributesSchema } from "./outfit-items";

/**
 * The Dupe Hunter's structured description of a garment. The vision step
 * fills it; the catalogue matcher (src/server/services/dupe-match.ts) reads
 * it. Every field is optional on DupeAttributes so attributes stored before
 * this spec existed (post_items.attributes) still rank: the matcher infers
 * what it can from the name and silhouette tags.
 *
 * Isomorphic: constants and zod only, safe to import on the client.
 */

/** The precise kind of garment. Category alone lumps a tailored coat in with
 * track jackets and fleeces (all "Outerwear"); the kind is what keeps them
 * apart. "other" means none of these fit, and switches the kind filter off. */
export const GARMENT_TYPES = [
  // Outerwear
  "coat",
  "trench coat",
  "blazer",
  "jacket",
  "denim jacket",
  "leather jacket",
  "puffer",
  "parka",
  "vest",
  "athletic jacket",
  // Tops
  "t-shirt",
  "shirt",
  "blouse",
  "top",
  "tank top",
  "sweater",
  "cardigan",
  "sweatshirt",
  "polo",
  "bodysuit",
  // Bottoms
  "jeans",
  "trousers",
  "skirt",
  "shorts",
  "leggings",
  "joggers",
  // Dresses
  "dress",
  "jumpsuit",
  // Shoes
  "sneakers",
  "heels",
  "boots",
  "flats",
  "sandals",
  "loafers",
  // Bags
  "tote",
  "shoulder bag",
  "crossbody bag",
  "clutch",
  "backpack",
  "top-handle bag",
  // Jewelry
  "necklace",
  "earrings",
  "bracelet",
  "ring",
  // Accessories
  "belt",
  "hat",
  "scarf",
  "sunglasses",
  "watch",
  "socks",
  "gloves",
  "other",
] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];

/** How dressed-up the piece reads. Athletic never matches formal or smart.
 * "not applicable" for jewellery, bags and accessories, which are never
 * filtered on formality. */
export const FORMALITIES = ["formal", "smart", "casual", "athletic", "not applicable"] as const;
export type Formality = (typeof FORMALITIES)[number];

export const PATTERNS = [
  "solid",
  "striped",
  "plaid",
  "herringbone",
  "houndstooth",
  "floral",
  "polka dot",
  "animal print",
  "camouflage",
  "colour block",
  "graphic",
  "other",
] as const;
export type Pattern = (typeof PATTERNS)[number];

export const GARMENT_LENGTHS = [
  "cropped",
  "hip",
  "mid-thigh",
  "knee",
  "midi",
  "maxi",
  "not applicable",
] as const;
export type GarmentLength = (typeof GARMENT_LENGTHS)[number];

/** How the piece fastens: matched against the catalogue copy
 * ("double-breasted", "full-zip", "belted"...). */
export const CLOSURES = [
  "double-breasted",
  "single-breasted",
  "zip",
  "belted",
  "toggle",
  "snap",
  "pullover",
  "open front",
  "not applicable",
  "other",
] as const;
export type Closure = (typeof CLOSURES)[number];

export const GENDER_FITS = ["womenswear", "menswear", "unisex"] as const;
export type GenderFit = (typeof GENDER_FITS)[number];

/** How close the best catalogue match is. "none" means nothing passed the
 * similarity threshold, and the hunt returned no pieces rather than
 * unrelated ones. */
export const MATCH_QUALITIES = ["identical", "close", "none"] as const;
export type MatchQuality = (typeof MATCH_QUALITIES)[number];

export const DupeSpecFieldsSchema = z.object({
  garment_type: z.enum(GARMENT_TYPES),
  gender_fit: z.enum(GENDER_FITS),
  formality: z.enum(FORMALITIES),
  closure: z.enum(CLOSURES),
  pattern: z.enum(PATTERNS),
  colors: z.array(z.string().max(40)).max(4),
  length: z.enum(GARMENT_LENGTHS),
  fabric: z.string().max(60),
  key_details: z.array(z.string().max(60)).max(6),
});
export type DupeSpecFields = z.infer<typeof DupeSpecFieldsSchema>;

/** An optional spec field that drops an invalid value instead of failing
 * the whole object: one off-vocabulary answer never loses the rest of the
 * read, and an older or newer client never gets a validation error. */
function lenient<T extends z.ZodTypeAny>(schema: T) {
  return schema.optional().catch(undefined);
}

/** The spec fields as optional, lenient zod fields, for extending
 * ClothingAttributesSchema wherever attributes are accepted. */
export const DUPE_SPEC_OPTIONAL_FIELDS = {
  garment_type: lenient(DupeSpecFieldsSchema.shape.garment_type),
  gender_fit: lenient(DupeSpecFieldsSchema.shape.gender_fit),
  formality: lenient(DupeSpecFieldsSchema.shape.formality),
  closure: lenient(DupeSpecFieldsSchema.shape.closure),
  pattern: lenient(DupeSpecFieldsSchema.shape.pattern),
  colors: lenient(DupeSpecFieldsSchema.shape.colors),
  length: lenient(DupeSpecFieldsSchema.shape.length),
  fabric: lenient(DupeSpecFieldsSchema.shape.fabric),
  key_details: lenient(DupeSpecFieldsSchema.shape.key_details),
};

/** Legacy attributes plus whichever spec fields are known. */
export const DupeAttributesSchema = ClothingAttributesSchema.extend(DUPE_SPEC_OPTIONAL_FIELDS);
export type DupeAttributes = z.infer<typeof DupeAttributesSchema>;

/** ClothingAttributesSchema caps `name` at 100 characters; a long AI name
 * used to fail the whole (already paid) hunt with a raw validation error. */
const MAX_NAME_LENGTH = 100;
const MAX_LIST_ITEMS = { colors: 4, key_details: 6 } as const;
const MAX_TEXT_LENGTH = 60;
/** Matches DupeSpecFieldsSchema's per-colour cap, so one long colour is
 * trimmed instead of dropping the whole `colors` list. */
const MAX_COLOUR_LENGTH = 40;

/**
 * `text` cut to at most `max` UTF-16 units, on a character (grapheme)
 * boundary. Exactly `text.slice(0, max)` unless that cut would split a
 * character, such as an emoji's surrogate pair: that character is then left
 * out whole, so she never sees half an emoji. Nothing is added (no ellipsis):
 * the matcher reads these strings.
 */
// src: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter
function cutOnCharacter(text: string, max: number): string {
  if (text.length <= max) return text;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let out = "";
  for (const { segment } of segmenter.segment(text)) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  return out;
}

function trimList(value: unknown, max: number, itemLength = MAX_TEXT_LENGTH): unknown {
  if (!Array.isArray(value)) return value;
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => cutOnCharacter(v.trim(), itemLength))
    .slice(0, max);
}

/**
 * Parses a vision response into DupeAttributes. The legacy fields are
 * required exactly as before (a malformed answer still throws, and the
 * credit is refunded). Over-long names, lists and fabric text are trimmed to
 * fit rather than rejected; an invalid spec field is dropped on its own.
 */
export function parseDupeAttributes(raw: unknown): DupeAttributes {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return DupeAttributesSchema.parse({
    ...record,
    name:
      typeof record.name === "string"
        ? cutOnCharacter(record.name.trim(), MAX_NAME_LENGTH)
        : record.name,
    fabric:
      typeof record.fabric === "string"
        ? cutOnCharacter(record.fabric.trim(), MAX_TEXT_LENGTH)
        : record.fabric,
    colors: trimList(record.colors, MAX_LIST_ITEMS.colors, MAX_COLOUR_LENGTH),
    key_details: trimList(record.key_details, MAX_LIST_ITEMS.key_details),
  });
}
