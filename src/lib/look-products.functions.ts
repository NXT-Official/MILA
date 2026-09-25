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

/** A product matches when it's Unisex, matches the requested gender exactly,
 * or when no gender was requested (show everything rather than guess). */
export function isGenderMatch(productGender: string, requestedGender?: string): boolean {
  if (!requestedGender) return true;
  return productGender === "Unisex" || productGender === requestedGender;
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
 * How many candidates per category the model gets to choose from. The whole
 * catalog is eligible (see below); handing over more than one per category
 * gives the stylist a real choice, and rotating which ones within a score band
 * means the catalog is used across generations instead of the same few rows.
 */
const MAX_CANDIDATES_PER_CATEGORY = 4;

/** Products fetched per category before scoring in memory. */
const CATEGORY_FETCH_LIMIT = 500;

/** Rows per page while discovering which categories exist. */
const CATEGORY_PAGE_SIZE = 1000;

/** Safety bound on category discovery pages (10k products). */
const CATEGORY_PAGE_LIMIT = 10;

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

  const results: LookProduct[] = [];
  for (const category of categories) {
    const { data: candidates, error } = await supabase
      .from("products")
      .select(
        "id,title,brand_id,category,price,currency,image_url,affiliate_link,seasonal_palettes,body_shapes,available_regions,verification_status,last_verified_at,in_stock,gender",
      )
      .eq("category", category)
      .neq("verification_status", "broken")
      .eq("in_stock", true)
      .limit(CATEGORY_FETCH_LIMIT);
    if (error) {
      console.error("[findLookProducts] product query failed", error);
      throw new Error("Couldn't load the shoppable catalog.");
    }

    const ranked = (candidates ?? [])
      .filter((product) => isAvailableInRegion(product, region))
      .filter((product) => isGenderMatch(product.gender, gender))
      .map((product) => ({
        product,
        score: scoreProduct(product, colorSeason, bodyType),
        tiebreak: Math.random(),
      }))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.tiebreak - b.tiebreak))
      .slice(0, MAX_CANDIDATES_PER_CATEGORY);

    for (const { product } of ranked) {
      const {
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
