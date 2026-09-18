import { describe, expect, test } from "bun:test";
import { sortMatches } from "./post-item-drawer";
import type { DupeMatch } from "@/lib/dupe-hunter.functions";

function match(overrides: Partial<DupeMatch>): DupeMatch {
  return {
    id: "id",
    title: "Item",
    brand_id: "brand",
    category: "Tops",
    price: 0,
    currency: "USD",
    image_url: null,
    affiliate_link: "https://example.com",
    description: null,
    match_score: 0,
    match_reasons: [],
    verification_status: "unverified",
    last_verified_at: null,
    rating: null,
    units_sold: null,
    shipping_info: null,
    discount_percent: null,
    is_verified_seller: false,
    ...overrides,
  };
}

describe("sortMatches", () => {
  const matches = [
    match({ id: "a", price: 30 }),
    match({ id: "b", price: 10 }),
    match({ id: "c", price: 20 }),
  ];

  test("best_match leaves catalog scoring order untouched", () => {
    expect(sortMatches(matches, "best_match").map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  test("price_low sorts ascending by price", () => {
    expect(sortMatches(matches, "price_low").map((m) => m.id)).toEqual(["b", "c", "a"]);
  });

  test("price_high sorts descending by price", () => {
    expect(sortMatches(matches, "price_high").map((m) => m.id)).toEqual(["a", "c", "b"]);
  });

  test("does not mutate the input array", () => {
    const original = [...matches];
    sortMatches(matches, "price_low");
    expect(matches).toEqual(original);
  });
});
