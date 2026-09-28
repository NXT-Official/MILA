import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const Input = z.object({
  colorSeason: z.string().min(1).max(64),
  bodyType: z.string().min(1).max(64),
  tempF: z.number().min(-60).max(140).optional(),
  /** ISO 3166-1 alpha-2 country code. Empty/omitted = unknown, don't region-filter. */
  region: z.string().length(2).optional(),
  /** "Male" | "Female" | omitted. Omitted (unknown/Non-binary/prefer-not-to-say)
   * means don't gender-filter — show the full catalog rather than guess. */
  gender: z.string().optional(),
  /** Decided once per look, server-side, when `gender` is omitted — never
   * both directions at once. Lets a category with no Unisex option (e.g.
   * Bottoms, Shoes) still surface real candidates without ever mixing
   * menswear and womenswear inside one look. See isGenderMatch. */
  fallbackDirection: z.enum(["Male", "Female"]).optional(),
});
export type LookProductsInput = z.infer<typeof Input>;

export type LookProduct = {
  id: string;
  title: string;
  brand_id: string;
  category: string;
  price: number;
  currency: string;
  image_url: string | null;
  affiliate_link: string;
  verification_status: string;
  last_verified_at: string | null;
};

/**
 * A live catalog row plus the server-only columns the inventory pipeline
 * needs: the description the reviewer reads to judge an untagged row, and the
 * palette/body-shape tags the prompt marks rows with. Never sent to a client
 * — LookProduct is the stripped, client-safe shape.
 */
export type LookInventoryItem = LookProduct & {
  description: string | null;
  seasonal_palettes: string[];
  body_shapes: string[];
};

/** A product matches when it's Unisex, matches the requested gender exactly,
 * or — with no requested gender — matches the once-per-look
 * `fallbackDirection` chosen server-side before the catalog loads (see
 * generateLookForUser). With neither supplied, matches everything (show the
 * full catalog rather than guess) — `matchLookProducts`'s callers never pass
 * `fallbackDirection`, so their behavior is unchanged. */
export function isGenderMatch(
  productGender: string,
  requestedGender?: string,
  fallbackDirection?: string,
): boolean {
  if (requestedGender) return productGender === "Unisex" || productGender === requestedGender;
  if (fallbackDirection) return productGender === "Unisex" || productGender === fallbackDirection;
  return true;
}

const HOT_WEATHER_F = 75;

/** +50 for an exact seasonal-palette match, +30 for an exact body-shape match. */
export function scoreProduct(
  product: { seasonal_palettes: string[]; body_shapes: string[] },
  colorSeason: string,
  bodyType: string,
): number {
  let score = 0;
  if (product.seasonal_palettes.includes(colorSeason)) score += 50;
  if (product.body_shapes.includes(bodyType)) score += 30;
  return score;
}

/**
 * A product with an empty `available_regions` ships everywhere. An unknown
 * (empty) user region means "don't filter" rather than excluding everything —
 * we'd rather over-show than silently hide the whole catalog.
 */
export function isAvailableInRegion(
  product: { available_regions: string[] },
  region?: string,
): boolean {
  if (!region) return true;
  if (product.available_regions.length === 0) return true;
  return product.available_regions.includes(region);
}

/**
 * How many candidates per category the single-call path
 * (`matchLookProducts`) hands over — it caps what the model SEES, so it stays
 * small. The two-stage inventory pipeline (`loadLookInventory` +
 * formatInventoryForPrompt) hands the reviewer the whole catalog instead.
 */
const MAX_CANDIDATES_PER_CATEGORY = 4;

/**
 * Rows the inventory pipeline hands the review prompt per category, and in
 * total. The live catalog is a few hundred rows today and fits entirely; the
 * caps only exist so a much larger catalog degrades by rotating what the
 * reviewer sees (palette/body matches lead, tie-breaks rotate) instead of
 * quietly blowing past what the prompt budget can carry. INVENTORY_MAX_LINES
 * is the hard stop; per-category rows are sliced first.
 */
export const INVENTORY_MAX_PER_CATEGORY = 150;
export const INVENTORY_MAX_LINES = 1200;

/** Cap on how many shortlisted items the plan stage may receive. */
export const MAX_SHORTLIST_ITEMS = 40;

/** Similar-shelf caps. Small on purpose: the planned pieces ARE the look;
 * these are extra shoppable options beside it, not a second look. */
export const MAX_SIMILAR_PER_CATEGORY = 2;
export const MAX_SIMILAR_TOTAL = 8;

/** Products fetched per category before scoring in memory. */
const CATEGORY_FETCH_LIMIT = 500;

/** Rows per page while discovering which categories exist. */
const CATEGORY_PAGE_SIZE = 1000;

/** Safety bound on category discovery pages (10k products). */
const CATEGORY_PAGE_LIMIT = 10;

/** The raw product row shape both selection paths read (and the tests fake). */
type RawProductRow = {
  id: string;
  title: string;
  brand_id: string;
  category: string;
  price: number;
  currency: string;
  image_url: string | null;
  affiliate_link: string;
  description: string | null;
  seasonal_palettes: string[];
  body_shapes: string[];
  available_regions: string[];
  verification_status: string;
  last_verified_at: string | null;
  in_stock: boolean;
  gender: string;
};

async function loadCategories(supabase: SupabaseClient<Database>): Promise<string[]> {
  const categories = new Set<string>();
  for (let page = 0; page < CATEGORY_PAGE_LIMIT; page += 1) {
    const { data, error } = await supabase
      .from("products")
      .select("category")
      .range(page * CATEGORY_PAGE_SIZE, (page + 1) * CATEGORY_PAGE_SIZE - 1);
    if (error) {
      console.error("[findLookProducts] category query failed", error);
      throw new Error("Couldn't load the shoppable catalog.");
    }
    const rows = data ?? [];
    for (const row of rows) {
      if (row.category) categories.add(row.category);
    }
    if (rows.length < CATEGORY_PAGE_SIZE) break;
  }
  return [...categories];
}

/**
 * Every eligible row in one category, ranked: palette/body-shape matches
 * first, then untagged rows in a rotating random order so the full catalog
 * stays reachable across generations. Shared by both selection paths so
 * their eligibility rules (region, gender, stock, broken links, hot-weather
 * outerwear) can never drift apart.
 */
async function fetchRankedCategory(
  supabase: SupabaseClient<Database>,
  category: string,
  { colorSeason, bodyType, region, gender, fallbackDirection }: LookProductsInput,
): Promise<Array<{ product: RawProductRow; score: number; tiebreak: number }>> {
  const { data: candidates, error } = await supabase
    .from("products")
    .select(
      "id,title,brand_id,category,price,currency,image_url,affiliate_link,description,seasonal_palettes,body_shapes,available_regions,verification_status,last_verified_at,in_stock,gender",
    )
    .eq("category", category)
    .neq("verification_status", "broken")
    .eq("in_stock", true)
    .limit(CATEGORY_FETCH_LIMIT);
  if (error) {
    console.error("[findLookProducts] product query failed", error);
    throw new Error("Couldn't load the shoppable catalog.");
  }

  return ((candidates ?? []) as unknown as RawProductRow[])
    .filter((product) => isAvailableInRegion(product, region))
    .filter((product) => isGenderMatch(product.gender, gender, fallbackDirection))
    .map((product) => ({
      product,
      score: scoreProduct(product, colorSeason, bodyType),
      tiebreak: Math.random(),
    }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.tiebreak - b.tiebreak));
}

/**
 * Shoppable candidates for a Daily Look — catalog-only, no AI call, no credit
 * charge (same family as findSimilarItems in dupe-hunter.functions.ts).
 *
 * Every in-stock, non-broken product that matches the user's gender/region is
 * eligible, whether or not it carries palette/body-shape tags: a tag match
 * ranks a product first (+50 palette, +30 body shape), but an untagged product
 * is still offerable rather than invisible. Selection is per category, capped
 * at MAX_CANDIDATES_PER_CATEGORY, rotated randomly within each score band so
 * the full catalog is reachable over successive generations.
 */
export async function matchLookProducts(
  supabase: SupabaseClient<Database>,
  { colorSeason, bodyType, tempF, region, gender }: LookProductsInput,
): Promise<LookProduct[]> {
  let categories = await loadCategories(supabase);
  if (categories.length === 0) return [];
  if (tempF != null && tempF > HOT_WEATHER_F) {
    categories = categories.filter((category) => category !== "Outerwear");
  }

  const input: LookProductsInput = { colorSeason, bodyType, tempF, region, gender };
  const results: LookProduct[] = [];
  for (const category of categories) {
    const ranked = (await fetchRankedCategory(supabase, category, input)).slice(
      0,
      MAX_CANDIDATES_PER_CATEGORY,
    );

    for (const { product } of ranked) {
      const {
        description: _description,
        seasonal_palettes: _seasonalPalettes,
        body_shapes: _bodyShapes,
        available_regions: _availableRegions,
        in_stock: _inStock,
        gender: _gender,
        ...rest
      } = product;
      results.push(rest);
    }
  }

  return results;
}

/**
 * The WHOLE eligible catalog for one client — every in-stock, non-broken row
 * that ships to their region and fits their gender, with the description and
 * tag columns the review prompt needs. Ordered by category; within a
 * category, palette/body-shape matches lead and tie-breaks rotate (see
 * fetchRankedCategory).
 *
 * This is the material for the two-stage pipeline in look.ts: deepseek first
 * reviews this list against the style profile and shortlists from it, then
 * composes the outfit from that shortlist (generateLookForUser).
 */
export async function loadLookInventory(
  supabase: SupabaseClient<Database>,
  { colorSeason, bodyType, tempF, region, gender, fallbackDirection }: LookProductsInput,
): Promise<LookInventoryItem[]> {
  let categories = await loadCategories(supabase);
  if (categories.length === 0) return [];
  if (tempF != null && tempF > HOT_WEATHER_F) {
    categories = categories.filter((category) => category !== "Outerwear");
  }

  const input: LookProductsInput = { colorSeason, bodyType, tempF, region, gender, fallbackDirection };
  const results: LookInventoryItem[] = [];
  for (const category of categories) {
    const ranked = (await fetchRankedCategory(supabase, category, input)).slice(
      0,
      INVENTORY_MAX_PER_CATEGORY,
    );

    for (const { product } of ranked) {
      const {
        available_regions: _availableRegions,
        in_stock: _inStock,
        gender: _gender,
        ...rest
      } = product;
      results.push(rest);
      if (results.length >= INVENTORY_MAX_LINES) return results;
    }
  }

  return results;
}

/** Longest description slice included per inventory row in the prompt. Enough
 * for garment type + color + fabric + construction; the full text stays
 * server-side (the plan stage gets it back, but only for the shortlist). */
const INVENTORY_DESCRIPTION_CLIP = 120;

/** Whitespace-collapsed, word-boundary-clipped description — or null. */
function clipDescription(description: string | null): string | null {
  if (!description) return null;
  const collapsed = description.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  if (collapsed.length <= INVENTORY_DESCRIPTION_CLIP) return collapsed;
  const clipped = collapsed.slice(0, INVENTORY_DESCRIPTION_CLIP);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/**
 * The numbered inventory block for the review prompt. The row ORDER is the
 * contract: the model answers with indexes into this same array, and
 * resolveShortlist maps them back by position — build and parse must always
 * read the same list, in the same order.
 *
 * Row format (pinned by tests):
 *   {index} | {title} | {price} {currency}[ | [P][S]][ | {description}]
 * `[P]` = tagged with the client's seasonal palette, `[S]` = tagged for the
 * client's body shape. Most live rows carry neither tag; the description is
 * what there is to judge.
 */
export function formatInventoryForPrompt(
  inventory: LookInventoryItem[],
  { colorSeason, bodyType }: { colorSeason: string; bodyType: string },
): string {
  const lines: string[] = [];
  let currentCategory: string | null = null;
  inventory.forEach((item, index) => {
    if (item.category !== currentCategory) {
      currentCategory = item.category;
      lines.push(`### ${item.category}`);
    }
    const tags = [
      item.seasonal_palettes.includes(colorSeason) ? "[P]" : "",
      item.body_shapes.includes(bodyType) ? "[S]" : "",
    ]
      .filter(Boolean)
      .join("");
    const description = clipDescription(item.description);
    lines.push(
      [`${index}`, item.title, `${item.price} ${item.currency}`, tags || null, description]
        .filter((part): part is string => part != null && part !== "")
        .join(" | "),
    );
  });
  return lines.join("\n");
}

/**
 * Maps the review stage's raw `{ item, reason }` output back to real rows.
 * Lenient by design (defense in depth behind the tool schema): non-integer or
 * out-of-range indexes are dropped, duplicates collapse to the first
 * occurrence, order is preserved, and the list is capped. Anything that
 * survives is a real row from the same array the prompt was built from.
 */
export function resolveShortlist(
  rawShortlist: unknown,
  inventory: LookInventoryItem[],
  maxItems = MAX_SHORTLIST_ITEMS,
): LookInventoryItem[] {
  const parsed = z
    .array(z.object({ item: z.number(), reason: z.string().optional() }))
    .safeParse(rawShortlist);
  if (!parsed.success) return [];

  const seen = new Set<number>();
  const resolved: LookInventoryItem[] = [];
  for (const entry of parsed.data) {
    const index = entry.item;
    if (!Number.isInteger(index) || index < 0 || index >= inventory.length) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    resolved.push(inventory[index]);
    if (resolved.length >= maxItems) break;
  }
  return resolved;
}

/**
 * Extra shoppable options beside the planned outfit: for each category the
 * look actually uses, up to MAX_SIMILAR_PER_CATEGORY other live rows from
 * the same category — ranked like matchLookProducts (tag match first,
 * rotating tie-break), never one of the planned pieces themselves, and never
 * more than MAX_SIMILAR_TOTAL overall. Runs on the inventory already fetched
 * for the review stage, so this costs no extra DB read and no AI call.
 *
 * The rationale is deterministic server copy (the model never wrote about
 * these items); the caller tags each returned product with source "similar"
 * so the outfit's actual pieces stay distinguishable.
 */
export function pickSimilarAdditions(
  picks: Array<{ id: string; category: string }>,
  inventory: LookInventoryItem[],
  { colorSeason, bodyType }: { colorSeason: string; bodyType: string },
): Array<{ product: LookProduct; rationale: string }> {
  const pickedIds = new Set(picks.map((pick) => pick.id));
  const seenCategories = new Set<string>();
  const additions: Array<{ product: LookProduct; rationale: string }> = [];

  for (const pick of picks) {
    if (seenCategories.has(pick.category)) continue;
    seenCategories.add(pick.category);

    const ranked = inventory
      .filter((item) => item.category === pick.category && !pickedIds.has(item.id))
      .map((item) => ({
        item,
        score: scoreProduct(item, colorSeason, bodyType),
        tiebreak: Math.random(),
      }))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.tiebreak - b.tiebreak))
      .slice(0, MAX_SIMILAR_PER_CATEGORY);

    for (const { item } of ranked) {
      if (additions.length >= MAX_SIMILAR_TOTAL) return additions;
      const {
        description: _description,
        seasonal_palettes: _seasonalPalettes,
        body_shapes: _bodyShapes,
        ...product
      } = item;
      additions.push({
        product,
        rationale: item.seasonal_palettes.includes(colorSeason)
          ? `Similar to the ${item.category.toLowerCase()} in today's look — tagged for your ${colorSeason} palette.`
          : `Similar to the ${item.category.toLowerCase()} in today's look — another live option from the shop.`,
      });
    }
  }

  return additions;
}
