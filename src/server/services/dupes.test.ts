import { describe, expect, test } from "bun:test";
import { extractBudgetTag, priceTier, rankDupes } from "./dupes";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ClothingAttributes } from "@/lib/outfit-items";

const INSPIRATION: ClothingAttributes = {
  name: "Quilted vanity case",
  category: "Accessories",
  primary_color: "Cream",
  color_undertone: "Warm",
  silhouette_tags: ["quilted", "top-handle"],
};

type ProductRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  price: number;
  currency: string;
  image_url: string | null;
  affiliate_link: string;
  brand_id: string;
  seasonal_palettes: string[];
  available_regions: string[];
  in_stock: boolean;
  verification_status: string;
  last_verified_at: string | null;
  rating: number | null;
  units_sold: number | null;
  shipping_info: string | null;
  discount_percent: number | null;
  brands: { is_verified_seller: boolean } | null;
};

function product(id: string, overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id,
    title: `Quilted ${id}`,
    description: "quilted top-handle case in cream.",
    category: "Accessories",
    price: 100,
    currency: "USD",
    image_url: null,
    affiliate_link: `https://shop.example.com/${id}`,
    brand_id: "brand-1",
    seasonal_palettes: [],
    available_regions: [],
    in_stock: true,
    verification_status: "verified",
    last_verified_at: null,
    rating: null,
    units_sold: null,
    shipping_info: null,
    discount_percent: null,
    brands: { is_verified_seller: true },
    ...overrides,
  };
}

/** Minimal stand-in for the PostgREST chain rankDupes uses: select + ilike +
 * neq + eq + limit, resolving to the full row set (filtering already
 * happens in rankDupes itself against real query params in production; the
 * fake just hands back everything so the test controls exactly what rankDupes
 * sees). */
function fakeSupabase(rows: ProductRow[]): SupabaseClient<Database> {
  const from = () => {
    const chain = {
      select: () => chain,
      ilike: () => chain,
      neq: () => chain,
      eq: () => chain,
      limit: () => chain,
      then: (resolve: (v: { data: ProductRow[]; error: null }) => void) => {
        resolve({ data: rows, error: null });
      },
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

/** Stand-in that behaves like the catalogue query on the one filter this
 * suite cares about: `ilike("category", x)` keeps only rows whose category
 * equals x, case-insensitively. Records every ilike so a test can also assert
 * which category was searched. */
function catalogueSupabase(rows: ProductRow[]) {
  const searches: { column: string; pattern: string }[] = [];
  const from = () => {
    let matching = rows;
    const chain = {
      select: () => chain,
      ilike: (column: string, pattern: string) => {
        searches.push({ column, pattern });
        matching = matching.filter((r) => r.category.toLowerCase() === pattern.toLowerCase());
        return chain;
      },
      neq: () => chain,
      eq: () => chain,
      limit: () => chain,
      then: (resolve: (v: { data: ProductRow[]; error: null }) => void) => {
        resolve({ data: matching, error: null });
      },
    };
    return chain;
  };
  return { supabase: { from } as unknown as SupabaseClient<Database>, searches };
}

describe("extractBudgetTag", () => {
  test("returns the first recognized budget tag", () => {
    expect(extractBudgetTag(["Relaxed Fit", "Mid-Range", "Sneakers Preferred"])).toBe("Mid-Range");
  });

  test("returns null when no budget tag is present", () => {
    expect(extractBudgetTag(["Relaxed Fit", "Sneakers Preferred"])).toBeNull();
  });

  test("returns null for non-array, undefined, or null input", () => {
    expect(extractBudgetTag(undefined)).toBeNull();
    expect(extractBudgetTag(null)).toBeNull();
    expect(extractBudgetTag("Mid-Range")).toBeNull();
  });
});

describe("priceTier", () => {
  const prices = [10, 20, 30, 40, 50, 60, 70, 80, 90];

  test("splits into low/mid/high terciles by sorted position", () => {
    expect(priceTier(prices, 10)).toBe("low");
    expect(priceTier(prices, 30)).toBe("low");
    expect(priceTier(prices, 40)).toBe("mid");
    expect(priceTier(prices, 60)).toBe("mid");
    expect(priceTier(prices, 70)).toBe("high");
    expect(priceTier(prices, 90)).toBe("high");
  });

  test("a single price is always its own low tier", () => {
    expect(priceTier([42], 42)).toBe("low");
  });
});

describe("rankDupes budget alignment", () => {
  test("boosts and tags the reason for a candidate matching the Budget-Conscious tier", async () => {
    const supabase = fakeSupabase([
      product("cheap", { price: 20 }),
      product("mid", { price: 50 }),
      product("pricey", { price: 90 }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, "Budget-Conscious");
    const cheap = results.find((r) => r.id === "cheap");
    expect(cheap?.match_reasons).toContain("Fits your Budget-Conscious budget");
    // The boosted cheap item outranks equally-matched pricier items.
    expect(results[0].id).toBe("cheap");
  });

  test("boosts a candidate matching the Investment Pieces tier", async () => {
    const supabase = fakeSupabase([
      product("cheap", { price: 20 }),
      product("mid", { price: 50 }),
      product("pricey", { price: 90 }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, "Investment Pieces");
    const pricey = results.find((r) => r.id === "pricey");
    expect(pricey?.match_reasons).toContain("Fits your Investment Pieces budget");
    expect(results[0].id).toBe("pricey");
  });

  test("no budget tag leaves ranking and reasons unchanged", async () => {
    const supabase = fakeSupabase([
      product("cheap", { price: 20 }),
      product("pricey", { price: 90 }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, null);
    for (const r of results) {
      expect(r.match_reasons.some((reason) => reason.startsWith("Fits your"))).toBe(false);
    }
  });

  test("never surfaces an item that scored 0 on attribute match just because it fits the budget", async () => {
    const supabase = fakeSupabase([
      product("irrelevant", {
        price: 5,
        description: "plain leather sole, no quilting.",
        category: "Shoes",
        title: "Leather Loafers",
      }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, "Budget-Conscious");
    expect(results).toHaveLength(0);
  });
});

describe("rankDupes maxBudget", () => {
  test("drops candidates priced above the user-set ceiling", async () => {
    const supabase = fakeSupabase([
      product("cheap", { price: 20 }),
      product("mid", { price: 50 }),
      product("pricey", { price: 90 }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, null, 50);
    expect(results.map((r) => r.id).sort()).toEqual(["cheap", "mid"]);
  });

  test("a candidate priced exactly at the ceiling is kept", async () => {
    const supabase = fakeSupabase([product("edge", { price: 50 })]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, null, 50);
    expect(results.map((r) => r.id)).toEqual(["edge"]);
  });

  test("omitted maxBudget applies no ceiling", async () => {
    const supabase = fakeSupabase([product("pricey", { price: 90 })]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, null, null);
    expect(results.map((r) => r.id)).toEqual(["pricey"]);
  });

  test("combines with a budget tag: ceiling filters first, tag still re-ranks what's left", async () => {
    const supabase = fakeSupabase([
      product("cheap", { price: 20 }),
      product("mid", { price: 50 }),
      product("pricey", { price: 90 }),
    ]);
    const results = await rankDupes(supabase, INSPIRATION, 10, undefined, "Investment Pieces", 60);
    expect(results.map((r) => r.id)).not.toContain("pricey");
    expect(results[0].id).toBe("mid");
  });
});

describe("rankDupes category search", () => {
  const BAG: ClothingAttributes = { ...INSPIRATION, category: "Bags" };
  const NECKLACE: ClothingAttributes = {
    ...INSPIRATION,
    name: "Quilted gold pendant necklace",
    category: "Jewelry",
  };

  const CATALOGUE = [
    product("tote", { category: "Bags", title: "Quilted Tote" }),
    product("necklace", { category: "Jewelry", title: "Quilted Pendant Necklace" }),
    product("socks", { category: "Accessories", title: "Quilted Socks" }),
  ];

  test("a bag searches the Bags rows, never the Accessories ones", async () => {
    const { supabase, searches } = catalogueSupabase(CATALOGUE);
    const results = await rankDupes(supabase, BAG, 10);
    expect(searches).toEqual([{ column: "category", pattern: "Bags" }]);
    expect(results.map((r) => r.id)).toEqual(["tote"]);
  });

  test("jewellery searches the Jewelry rows, never the Accessories ones", async () => {
    const { supabase, searches } = catalogueSupabase(CATALOGUE);
    const results = await rankDupes(supabase, NECKLACE, 10);
    expect(searches).toEqual([{ column: "category", pattern: "Jewelry" }]);
    expect(results.map((r) => r.id)).toEqual(["necklace"]);
  });

  test("a belt or hat still searches the Accessories rows", async () => {
    const { supabase } = catalogueSupabase(CATALOGUE);
    const results = await rankDupes(supabase, INSPIRATION, 10);
    expect(results.map((r) => r.id)).toEqual(["socks"]);
  });
});
