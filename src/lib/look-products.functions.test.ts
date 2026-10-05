import { describe, expect, test } from "bun:test";
import {
  COLD_WEATHER_F,
  formatInventoryForPrompt,
  INVENTORY_MAX_PER_CATEGORY,
  isAvailableInRegion,
  isGenderMatch,
  loadLookInventory,
  matchLookProducts,
  MAX_SHORTLIST_ITEMS,
  MAX_SIMILAR_PER_CATEGORY,
  MAX_SIMILAR_TOTAL,
  needsColdWeatherOuterwear,
  pickSimilarAdditions,
  pickWeatherBackfill,
  resolveShortlist,
  scoreProduct,
  type LookInventoryItem,
} from "./look-products.functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type ProductRow = {
  id: string;
  title: string;
  brand_id: string;
  category: string;
  price: number;
  currency: string;
  image_url: string | null;
  affiliate_link: string;
  description?: string | null;
  seasonal_palettes: string[];
  body_shapes: string[];
  attire: string[];
  available_regions: string[];
  verification_status: string;
  last_verified_at: string | null;
  in_stock: boolean;
  gender: string;
};

const PRODUCTS: ProductRow[] = [
  {
    id: "top-match",
    title: "Warm Autumn Silk Blouse",
    brand_id: "b1",
    category: "Tops",
    price: 95,
    currency: "USD",
    image_url: null,
    affiliate_link: "https://shop.example.com/top-match",
    seasonal_palettes: ["Warm Autumn"],
    body_shapes: ["Hourglass"],
    attire: [],
    available_regions: [],
    verification_status: "verified",
    last_verified_at: "2026-01-01T00:00:00.000Z",
    in_stock: true,
    gender: "Unisex",
  },
  {
    id: "top-no-match",
    title: "Cool Winter Crop Top",
    brand_id: "b1",
    category: "Tops",
    price: 40,
    currency: "USD",
    image_url: null,
    affiliate_link: "https://shop.example.com/top-no-match",
    seasonal_palettes: ["Cool Winter"],
    body_shapes: ["Pear"],
    attire: [],
    available_regions: [],
    verification_status: "verified",
    last_verified_at: "2026-01-01T00:00:00.000Z",
    in_stock: true,
    gender: "Unisex",
  },
  {
    id: "outerwear-match",
    title: "Warm Autumn Wool Coat",
    brand_id: "b2",
    category: "Outerwear",
    price: 248,
    currency: "USD",
    image_url: null,
    affiliate_link: "https://shop.example.com/outerwear-match",
    seasonal_palettes: ["Warm Autumn"],
    body_shapes: ["Hourglass"],
    attire: [],
    available_regions: [],
    verification_status: "verified",
    last_verified_at: "2026-01-01T00:00:00.000Z",
    in_stock: true,
    gender: "Unisex",
  },
];

/** Untagged rows — the shape most of the live catalog has (no palette/body tags). */
function untagged(id: string, category: string, overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id,
    title: `Untagged ${id}`,
    brand_id: "b3",
    category,
    price: 60,
    currency: "USD",
    image_url: null,
    affiliate_link: `https://shop.example.com/${id}`,
    seasonal_palettes: [],
    body_shapes: [],
    attire: [],
    available_regions: [],
    verification_status: "verified",
    last_verified_at: "2026-01-01T00:00:00.000Z",
    in_stock: true,
    gender: "Unisex",
    ...overrides,
  };
}

/**
 * Minimal stand-in for the PostgREST chain the function uses: a category
 * discovery query (select + range) and a per-category product query
 * (select + eq/neq/limit).
 */
function fakeSupabase(rows: ProductRow[]): SupabaseClient<Database> {
  const from = () => {
    let filterCategory: string | null = null;
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    const chain = {
      select: () => chain,
      eq: (column: string, value: string | boolean) => {
        if (column === "category") filterCategory = value as string;
        return chain;
      },
      neq: () => chain,
      limit: () => chain,
      range: (from: number, to: number) => {
        rangeFrom = from;
        rangeTo = to;
        return chain;
      },
      then: (resolve: (v: { data: ProductRow[]; error: null }) => void) => {
        // Category discovery: unpaginated read of every row, honouring range.
        if (!filterCategory) {
          const data =
            rangeFrom != null && rangeTo != null ? rows.slice(rangeFrom, rangeTo + 1) : rows;
          resolve({ data, error: null });
          return;
        }
        const data = rows.filter(
          (r) => r.category === filterCategory && r.verification_status !== "broken" && r.in_stock,
        );
        resolve({ data, error: null });
      },
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

describe("scoreProduct", () => {
  test("adds 50 for a seasonal-palette match and 30 for a body-shape match", () => {
    const product = { seasonal_palettes: ["Warm Autumn"], body_shapes: ["Hourglass"] };
    expect(scoreProduct(product, "Warm Autumn", "Hourglass")).toBe(80);
    expect(scoreProduct(product, "Cool Winter", "Hourglass")).toBe(30);
    expect(scoreProduct(product, "Warm Autumn", "Pear")).toBe(50);
    expect(scoreProduct(product, "Cool Winter", "Pear")).toBe(0);
  });
});

describe("isAvailableInRegion", () => {
  test("ships everywhere when available_regions is empty", () => {
    expect(isAvailableInRegion({ available_regions: [] }, "US")).toBe(true);
    expect(isAvailableInRegion({ available_regions: [] }, undefined)).toBe(true);
  });

  test("doesn't filter when the user's region is unknown", () => {
    expect(isAvailableInRegion({ available_regions: ["US", "CA"] }, undefined)).toBe(true);
  });

  test("gates on an explicit region list", () => {
    expect(isAvailableInRegion({ available_regions: ["US", "CA"] }, "US")).toBe(true);
    expect(isAvailableInRegion({ available_regions: ["US", "CA"] }, "JP")).toBe(false);
  });
});

describe("matchLookProducts", () => {
  test("ranks a palette/body-shape match first, then fills from the same category", async () => {
    const supabase = fakeSupabase([
      ...PRODUCTS,
      untagged("top-untagged", "Tops"),
      untagged("outerwear-untagged", "Outerwear"),
    ]);
    const results = await matchLookProducts(supabase, {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
    });

    // The tag match leads its category — it is never crowded out by untagged rows.
    expect(results[0].id).toBe("top-match");
    expect(results.find((r) => r.category === "Tops")?.id).toBe("top-match");
    expect(results.find((r) => r.category === "Outerwear")?.id).toBe("outerwear-match");
    // Untagged rows are still offered, so the whole catalog is reachable.
    expect(results.some((r) => r.id === "top-untagged")).toBe(true);
    expect(results.some((r) => r.id === "outerwear-untagged")).toBe(true);
  });

  test("offers untagged products when nothing matches the palette/body shape", async () => {
    const supabase = fakeSupabase(PRODUCTS);
    const results = await matchLookProducts(supabase, {
      colorSeason: "Cool Summer",
      bodyType: "Rectangle",
    });
    // Previously dropped entirely; the untagged/no-match rows are now candidates.
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.id).sort()).toEqual([
      "outerwear-match",
      "top-match",
      "top-no-match",
    ]);
  });

  test("caps candidates per category", async () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => untagged(`top-${i}`, "Tops")),
      ...Array.from({ length: 10 }, (_, i) => untagged(`bag-${i}`, "Bags")),
    ];
    const supabase = fakeSupabase(rows);
    const results = await matchLookProducts(supabase, {
      colorSeason: "Cool Summer",
      bodyType: "Rectangle",
    });
    expect(results.filter((r) => r.category === "Tops")).toHaveLength(4);
    expect(results.filter((r) => r.category === "Bags")).toHaveLength(4);
  });

  test("discovers categories beyond the first page of rows", async () => {
    const rows: ProductRow[] = [
      ...Array.from({ length: 1000 }, (_, i) => untagged(`top-${i}`, "Tops")),
      untagged("shoe-beyond-page-one", "Shoes"),
    ];
    const supabase = fakeSupabase(rows);
    const results = await matchLookProducts(supabase, {
      colorSeason: "Cool Summer",
      bodyType: "Rectangle",
    });
    expect(results.some((r) => r.category === "Shoes")).toBe(true);
  });

  test("excludes Outerwear entirely above 75°F, even if it would have matched", async () => {
    const supabase = fakeSupabase(PRODUCTS);
    const results = await matchLookProducts(supabase, {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
      tempF: 82,
    });
    expect(results.some((r) => r.category === "Outerwear")).toBe(false);
    expect(results.find((r) => r.category === "Tops")?.id).toBe("top-match");
  });

  test("excludes a product not shipping to the user's region", async () => {
    const regionLocked: ProductRow[] = [
      { ...PRODUCTS[0], id: "us-only", available_regions: ["US"] },
    ];
    const supabase = fakeSupabase(regionLocked);
    const inRegion = await matchLookProducts(supabase, {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
      region: "US",
    });
    expect(inRegion.find((r) => r.category === "Tops")?.id).toBe("us-only");

    const outOfRegion = await matchLookProducts(supabase, {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
      region: "JP",
    });
    expect(outOfRegion.some((r) => r.category === "Tops")).toBe(false);
  });

  test("excludes broken links and out-of-stock products even when they'd otherwise win", async () => {
    const rows: ProductRow[] = [
      { ...PRODUCTS[0], id: "broken-link", verification_status: "broken" },
      { ...PRODUCTS[0], id: "sold-out", in_stock: false },
    ];
    const supabase = fakeSupabase(rows);
    const results = await matchLookProducts(supabase, {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
    });
    expect(results.find((r) => r.category === "Tops")).toBeUndefined();
  });

  test("excludes opposite-gender products and keeps Unisex ones when a gender is requested", async () => {
    const rows: ProductRow[] = [
      { ...PRODUCTS[0], id: "womens-top", gender: "Female" },
      { ...PRODUCTS[0], id: "unisex-top", gender: "Unisex", price: 10 },
    ];
    const supabase = fakeSupabase(rows);
    const results = await matchLookProducts(supabase, {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
      gender: "Male",
    });
    const topIds = results.filter((r) => r.category === "Tops").map((r) => r.id);
    expect(topIds).toContain("unisex-top");
    expect(topIds).not.toContain("womens-top");
  });

  test("doesn't gender-filter when no gender is requested", async () => {
    const rows: ProductRow[] = [{ ...PRODUCTS[0], id: "womens-top", gender: "Female" }];
    const supabase = fakeSupabase(rows);
    const results = await matchLookProducts(supabase, {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
    });
    expect(results.find((r) => r.category === "Tops")?.id).toBe("womens-top");
  });
});

describe("isGenderMatch", () => {
  test("matches everything when neither a gender nor a fallback direction was requested", () => {
    expect(isGenderMatch("Male", undefined)).toBe(true);
    expect(isGenderMatch("Female", undefined)).toBe(true);
    expect(isGenderMatch("Unisex", undefined)).toBe(true);
  });

  test("Unisex products always match a requested gender", () => {
    expect(isGenderMatch("Unisex", "Male")).toBe(true);
    expect(isGenderMatch("Unisex", "Female")).toBe(true);
  });

  test("gendered products only match their own gender", () => {
    expect(isGenderMatch("Male", "Male")).toBe(true);
    expect(isGenderMatch("Male", "Female")).toBe(false);
    expect(isGenderMatch("Female", "Female")).toBe(true);
    expect(isGenderMatch("Female", "Male")).toBe(false);
  });

  test("an explicit requestedGender takes priority over fallbackDirection", () => {
    expect(isGenderMatch("Male", "Male", "Female")).toBe(true);
    expect(isGenderMatch("Female", "Male", "Female")).toBe(false);
  });

  test("with no requestedGender, falls back to matching the fallback direction (or Unisex)", () => {
    expect(isGenderMatch("Unisex", undefined, "Male")).toBe(true);
    expect(isGenderMatch("Male", undefined, "Male")).toBe(true);
    expect(isGenderMatch("Female", undefined, "Male")).toBe(false);
  });
});

/** A full inventory row (the stripped LookProduct shape + server-only columns). */
function inventoryItem(id: string, overrides: Partial<LookInventoryItem> = {}): LookInventoryItem {
  return {
    id,
    title: `Item ${id}`,
    brand_id: "b1",
    category: "Tops",
    price: 100,
    currency: "USD",
    image_url: null,
    affiliate_link: `https://shop.example.com/${id}`,
    verification_status: "verified",
    last_verified_at: null,
    description: null,
    seasonal_palettes: [],
    body_shapes: [],
    attire: [],
    ...overrides,
  };
}

describe("loadLookInventory", () => {
  test("returns every eligible row in a category, not just a handful", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => untagged(`top-${i}`, "Tops"));
    const results = await loadLookInventory(fakeSupabase(rows), {
      colorSeason: "Cool Summer",
      bodyType: "Rectangle",
    });
    expect(results.filter((r) => r.category === "Tops")).toHaveLength(10);
  });

  test("keeps descriptions and palette/body tags; strips stock/region/gender bookkeeping", async () => {
    const rows = [
      untagged("top-tagged", "Tops", {
        seasonal_palettes: ["Warm Autumn"],
        body_shapes: ["Hourglass"],
        description: "Short-sleeved cream ditsy-floral top.",
      }),
    ];
    const [item] = await loadLookInventory(fakeSupabase(rows), {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
    });
    expect(item).toMatchObject({
      id: "top-tagged",
      description: "Short-sleeved cream ditsy-floral top.",
      seasonal_palettes: ["Warm Autumn"],
      body_shapes: ["Hourglass"],
    });
    expect(item).not.toHaveProperty("in_stock");
    expect(item).not.toHaveProperty("gender");
    expect(item).not.toHaveProperty("available_regions");
  });

  test("applies the same eligibility rules as the candidate matcher", async () => {
    const rows: ProductRow[] = [
      { ...PRODUCTS[0], id: "womens-top", gender: "Female", category: "Tops" },
      { ...PRODUCTS[0], id: "outerwear", category: "Outerwear" },
      { ...PRODUCTS[0], id: "us-only", category: "Tops", available_regions: ["US"] },
    ];
    const forMale = await loadLookInventory(fakeSupabase(rows), {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
      gender: "Male",
      tempF: 82,
      region: "JP",
    });
    expect(forMale.some((r) => r.id === "womens-top")).toBe(false);
    expect(forMale.some((r) => r.category === "Outerwear")).toBe(false);
    expect(forMale.some((r) => r.id === "us-only")).toBe(false);
  });

  test("with no requestedGender, prefers Unisex but falls back to the chosen direction per category", async () => {
    const rows: ProductRow[] = [
      { ...PRODUCTS[0], id: "unisex-top", category: "Tops", gender: "Unisex" },
      { ...PRODUCTS[0], id: "mens-top", category: "Tops", gender: "Male" },
      { ...PRODUCTS[0], id: "womens-top", category: "Tops", gender: "Female" },
      // Bottoms has no Unisex option at all — only the fallback direction should surface.
      { ...PRODUCTS[0], id: "mens-bottom", category: "Bottoms", gender: "Male" },
      { ...PRODUCTS[0], id: "womens-bottom", category: "Bottoms", gender: "Female" },
    ];
    const results = await loadLookInventory(fakeSupabase(rows), {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
      fallbackDirection: "Male",
    });
    const topIds = results.filter((r) => r.category === "Tops").map((r) => r.id);
    const bottomIds = results.filter((r) => r.category === "Bottoms").map((r) => r.id);
    expect(topIds).toContain("unisex-top");
    expect(topIds).toContain("mens-top");
    expect(topIds).not.toContain("womens-top");
    expect(bottomIds).toEqual(["mens-bottom"]);
  });

  test("caps a category at INVENTORY_MAX_PER_CATEGORY rows", async () => {
    const rows = Array.from({ length: INVENTORY_MAX_PER_CATEGORY + 10 }, (_, i) =>
      untagged(`top-${i}`, "Tops"),
    );
    const results = await loadLookInventory(fakeSupabase(rows), {
      colorSeason: "Cool Summer",
      bodyType: "Rectangle",
    });
    expect(results).toHaveLength(INVENTORY_MAX_PER_CATEGORY);
  });
});

describe("formatInventoryForPrompt", () => {
  test("numbers rows by position, groups by category, and marks tagged rows", () => {
    const inventory = [
      inventoryItem("prod-1", {
        title: "Adina Top",
        price: 148,
        description: "Short-sleeved cream ditsy-floral top with curved neckline.",
        seasonal_palettes: ["Warm Autumn"],
        body_shapes: ["Hourglass"],
      }),
      inventoryItem("prod-2", {
        title: "Jeane Skirt",
        category: "Bottoms",
        price: 132,
      }),
    ];

    const block = formatInventoryForPrompt(inventory, {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
    });
    expect(block).toBe(
      [
        "### Tops",
        "0 | Adina Top | 148 USD | [P][S] | Short-sleeved cream ditsy-floral top with curved neckline.",
        "### Bottoms",
        "1 | Jeane Skirt | 132 USD",
      ].join("\n"),
    );
  });

  test("includes the attire register segment before the description when present", () => {
    const inventory = [
      inventoryItem("prod-1", {
        title: "Wool Suit Trouser",
        category: "Bottoms",
        attire: ["Business Professional", "Business Casual"],
        description: "Tailored wool trousers.",
      }),
    ];

    const block = formatInventoryForPrompt(inventory, {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
    });
    expect(block).toContain(
      "0 | Wool Suit Trouser | 100 USD | Business Professional/Business Casual | Tailored wool trousers.",
    );
    // Untagged rows keep the old shape — no empty segment.
    expect(block).not.toContain("| |");
  });

  test("clips a long description at a word boundary with an ellipsis", () => {
    const description = `${"agua fresca linen ".repeat(20)}end`;
    const block = formatInventoryForPrompt([inventoryItem("prod-1", { description })], {
      colorSeason: "Cool Summer",
      bodyType: "Rectangle",
    });
    const descriptionPart = block.split("\n")[1].split(" | ")[3];
    expect(descriptionPart.endsWith("…")).toBe(true);
    expect(descriptionPart.length).toBeLessThanOrEqual(121);
    expect(description).toContain(descriptionPart.slice(0, -1));
  });
});

describe("resolveShortlist", () => {
  const inventory = ["a", "b", "c", "d"].map((id) => inventoryItem(id));

  test("maps indexes to rows in first-seen order", () => {
    const resolved = resolveShortlist(
      [
        { item: 2, reason: "best bottom" },
        { item: 0, reason: "best top" },
      ],
      inventory,
    );
    expect(resolved.map((r) => r.id)).toEqual(["c", "a"]);
  });

  test("drops out-of-range, non-integer, and duplicate indexes", () => {
    const resolved = resolveShortlist(
      [{ item: 4 }, { item: -1 }, { item: 1.5 }, { item: 1 }, { item: 1 }],
      inventory,
    );
    expect(resolved.map((r) => r.id)).toEqual(["b"]);
  });

  test("caps the shortlist and tolerates malformed input", () => {
    const manyItems = Array.from({ length: MAX_SHORTLIST_ITEMS + 20 }, (_, i) =>
      inventoryItem(`item-${i}`),
    );
    const many = manyItems.map((_, i) => ({ item: i, reason: "r" }));
    expect(resolveShortlist(many, manyItems)).toHaveLength(MAX_SHORTLIST_ITEMS);
    expect(resolveShortlist("nope", inventory)).toEqual([]);
    expect(resolveShortlist(undefined, inventory)).toEqual([]);
  });
});

describe("pickSimilarAdditions", () => {
  const picks = [
    { id: "top-1", category: "Tops" },
    { id: "shoe-1", category: "Shoes" },
  ];

  test("only adds rows from categories the look uses, never the picks themselves", () => {
    const inventory = [
      inventoryItem("top-1"),
      inventoryItem("top-2", { title: "Second Top" }),
      inventoryItem("bag-1", { category: "Bags" }),
    ];
    const additions = pickSimilarAdditions(picks, inventory, {
      colorSeason: "Cool Summer",
      bodyType: "Rectangle",
    });
    expect(additions.map((a) => a.product.id)).toEqual(["top-2"]);
  });

  test("caps at MAX_SIMILAR_PER_CATEGORY per category and MAX_SIMILAR_TOTAL overall", () => {
    const categories = ["Tops", "Shoes", "Bags", "Jewelry", "Dresses"];
    const inventory = categories.flatMap((category) =>
      Array.from({ length: 5 }, (_, i) => inventoryItem(`${category}-${i}`, { category })),
    );
    const additions = pickSimilarAdditions(
      categories.map((category) => ({ id: `${category}-pick`, category })),
      inventory,
      { colorSeason: "Cool Summer", bodyType: "Rectangle" },
    );
    expect(additions).toHaveLength(MAX_SIMILAR_TOTAL);
    expect(additions.filter((a) => a.product.category === "Tops")).toHaveLength(
      MAX_SIMILAR_PER_CATEGORY,
    );
  });

  test("prefers tagged matches and strips server-only columns from the additions", () => {
    const inventory = [
      inventoryItem("plain", { category: "Tops" }),
      inventoryItem("tagged", { category: "Tops", seasonal_palettes: ["Warm Autumn"] }),
    ];
    const additions = pickSimilarAdditions([{ id: "top-pick", category: "Tops" }], inventory, {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
    });
    expect(additions[0].product.id).toBe("tagged");
    expect(additions[0].rationale).toContain("Warm Autumn");
    expect(additions[0].product).not.toHaveProperty("description");
    expect(additions[0].product).not.toHaveProperty("seasonal_palettes");
    expect(additions[0].product).not.toHaveProperty("body_shapes");
  });
});

describe("needsColdWeatherOuterwear", () => {
  test("false when temperature is unknown or at/above COLD_WEATHER_F", () => {
    expect(needsColdWeatherOuterwear([], undefined)).toBe(false);
    expect(needsColdWeatherOuterwear([], COLD_WEATHER_F)).toBe(false);
    expect(needsColdWeatherOuterwear([], COLD_WEATHER_F + 10)).toBe(false);
  });

  test("false below COLD_WEATHER_F when an Outerwear pick already exists", () => {
    expect(needsColdWeatherOuterwear([{ category: "Tops" }, { category: "Outerwear" }], 40)).toBe(
      false,
    );
  });

  test("true below COLD_WEATHER_F with no Outerwear pick", () => {
    expect(needsColdWeatherOuterwear([{ category: "Tops" }, { category: "Shoes" }], 40)).toBe(true);
  });
});

describe("pickWeatherBackfill", () => {
  const picks = [{ id: "top-1", category: "Tops" }];

  test("returns null when the weather doesn't call for outerwear", () => {
    const inventory = [inventoryItem("coat-1", { category: "Outerwear" })];
    expect(
      pickWeatherBackfill(picks, inventory, {
        tempF: COLD_WEATHER_F,
        colorSeason: "Cool Summer",
        bodyType: "Rectangle",
      }),
    ).toBeNull();
  });

  test("returns null when the picks already include Outerwear", () => {
    const inventory = [inventoryItem("coat-1", { category: "Outerwear" })];
    expect(
      pickWeatherBackfill([...picks, { id: "coat-1", category: "Outerwear" }], inventory, {
        tempF: 40,
        colorSeason: "Cool Summer",
        bodyType: "Rectangle",
      }),
    ).toBeNull();
  });

  test("adds the best-scoring available Outerwear row when cold and missing one", () => {
    const inventory = [
      inventoryItem("coat-plain", { category: "Outerwear" }),
      inventoryItem("coat-tagged", {
        category: "Outerwear",
        seasonal_palettes: ["Warm Autumn"],
        body_shapes: ["Hourglass"],
      }),
    ];
    const result = pickWeatherBackfill(picks, inventory, {
      tempF: 40,
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
    });
    expect(result?.product.id).toBe("coat-tagged");
    expect(result?.rationale).toContain("temperature");
    expect(result?.product).not.toHaveProperty("description");
    expect(result?.product).not.toHaveProperty("seasonal_palettes");
  });

  test("never re-adds a piece already in picks", () => {
    const inventory = [inventoryItem("top-1", { category: "Tops" })];
    const result = pickWeatherBackfill(picks, inventory, {
      tempF: 40,
      colorSeason: "Cool Summer",
      bodyType: "Rectangle",
    });
    expect(result).toBeNull();
  });

  test("returns null when cold and missing outerwear but none exists in inventory", () => {
    const inventory = [inventoryItem("top-1", { category: "Tops" })];
    expect(
      pickWeatherBackfill(picks, inventory, {
        tempF: 40,
        colorSeason: "Cool Summer",
        bodyType: "Rectangle",
      }),
    ).toBeNull();
  });
});
