import { describe, expect, test } from "bun:test";
import { matchLookProducts, scoreProduct } from "./look-products.functions";
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
  },
];

function fakeSupabase(rows: ProductRow[]): SupabaseClient<Database> {
  const from = () => {
    let filterCategory: string | null = null;
    const chain = {
      select: () => chain,
      eq: (_column: string, value: string) => {
        filterCategory = value;
        return chain;
      },
      limit: () => chain,
      then: (resolve: (v: { data: ProductRow[]; error: null }) => void) => {
        const data = filterCategory ? rows.filter((r) => r.category === filterCategory) : rows;
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
});
