import { describe, expect, test } from "bun:test";
import {
  isAvailableInRegion,
  isGenderMatch,
  matchLookProducts,
  scoreProduct,
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
  seasonal_palettes: string[];
  body_shapes: string[];
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
  test("matches when no gender was requested — show everything rather than guess", () => {
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
});
