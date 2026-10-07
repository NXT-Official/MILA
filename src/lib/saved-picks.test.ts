import { describe, expect, test } from "bun:test";
import type { ShoppablePick } from "./generate-outfit.functions";
import { normalizeSavedPicks, sanitizePicksForSave } from "./saved-picks";

function pick(overrides: Partial<ShoppablePick> = {}): ShoppablePick {
  return {
    id: "p1",
    title: "Silk Blouse",
    brand_id: "b1",
    category: "Tops",
    price: 120,
    currency: "USD",
    image_url: "https://img.example/a.jpg",
    affiliate_link: "https://shop.example/p1",
    verification_status: "verified",
    last_verified_at: "2026-10-01T00:00:00Z",
    rationale: "Suits the palette.",
    ...overrides,
  };
}

describe("sanitizePicksForSave", () => {
  test("undefined/null stays undefined — the key is omitted from the row", () => {
    expect(sanitizePicksForSave(undefined)).toBeUndefined();
    expect(sanitizePicksForSave(null)).toBeUndefined();
  });

  test("keeps valid picks with both https and http links", () => {
    const picks = [pick(), pick({ id: "p2", affiliate_link: "http://shop.example/p2" })];
    expect(sanitizePicksForSave(picks)).toEqual(picks);
  });

  test("drops a pick whose affiliate link is not http(s)", () => {
    const picks = [pick(), pick({ id: "evil", affiliate_link: "javascript:alert(1)" })];
    const out = sanitizePicksForSave(picks);
    expect(out?.map((item) => item.id)).toEqual(["p1"]);
  });

  test("nulls a non-http image instead of persisting it", () => {
    const out = sanitizePicksForSave([pick({ image_url: "data:image/png;base64,xx" })]);
    expect(out?.[0]?.image_url).toBeNull();
  });
});

describe("normalizeSavedPicks", () => {
  test("absent or non-array stays undefined — the History section hides", () => {
    expect(normalizeSavedPicks(undefined)).toBeUndefined();
    expect(normalizeSavedPicks(null)).toBeUndefined();
    expect(normalizeSavedPicks({ nope: true })).toBeUndefined();
  });

  test("an empty saved array stays an array — the grid shows its empty copy", () => {
    expect(normalizeSavedPicks([])).toEqual([]);
  });

  test("tolerates damaged entries: drops bad links and junk, defaults missing fields", () => {
    const out = normalizeSavedPicks([
      {
        id: "p1",
        title: "Blouse",
        affiliate_link: "https://shop.example/p1",
        price: 120,
        currency: "USD",
        image_url: "https://img.example/a.jpg",
      },
      { id: "bad", title: "No link", affiliate_link: "javascript:x" },
      { title: "Missing id", affiliate_link: "https://shop.example/x" },
      "junk",
      {
        id: "img",
        title: "Bad image",
        affiliate_link: "https://shop.example/img",
        image_url: "javascript:x",
      },
    ]);
    expect(out?.map((item) => item.id)).toEqual(["p1", "img"]);
    expect(out?.[0]?.rationale).toBe("");
    expect(out?.[0]?.brand_id).toBe("");
    expect(out?.[0]?.currency).toBe("USD");
    expect(out?.[1]?.image_url).toBeNull();
  });

  test("keeps the planned/similar source when present", () => {
    const out = normalizeSavedPicks([pick({ source: "similar" })]);
    expect(out?.[0]?.source).toBe("similar");
  });
});
