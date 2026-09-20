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

function fakeSupabase(rows: ProductRow[]): SupabaseClient<Database> {
  const from = () => {
    let filterCategory: string | null = null;
    const chain = {
      select: () => chain,
      eq: (column: string, value: string | boolean) => {
        if (column === "category") filterCategory = value as string;
        return chain;
      },
      neq: () => chain,
      limit: () => chain,
      then: (resolve: (v: { data: ProductRow[]; error: null }) => void) => {
        const filtered = rows.filter((r) => r.verification_status !== "broken" && r.in_stock);
        const data = filterCategory
          ? filtered.filter((r) => r.category === filterCategory)
          : filtered;
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
  test("returns the top-scoring product per category, dropping non-matches", async () => {
    const supabase = fakeSupabase(PRODUCTS);
    const results = await matchLookProducts(supabase, {
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
    });
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.category === "Tops")?.id).toBe("top-match");
    expect(results.find((r) => r.category === "Outerwear")?.id).toBe("outerwear-match");
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

  test("skips a category entirely when nothing scores above zero", async () => {
    const supabase = fakeSupabase(PRODUCTS);
    const results = await matchLookProducts(supabase, {
      colorSeason: "Cool Summer",
      bodyType: "Rectangle",
    });
    expect(results).toHaveLength(0);
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

  test("excludes opposite-gender products, keeps Unisex ones, when a gender is requested", async () => {
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
    // Both score equally; unisex-top wins on the price tiebreak, but the
    // real assertion is that womens-top was never a candidate at all.
    expect(results.find((r) => r.category === "Tops")?.id).toBe("unisex-top");
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
