import { describe, expect, test } from "bun:test";
import { CLOTHING_CATEGORIES } from "@/constants/wardrobe";
import {
  GARMENT_KEYWORDS,
  GARMENT_KINDS,
  GARMENT_KIND_ORDER,
  garmentFor,
  garmentKindHeading,
  garmentLine,
  recommendationAlt,
} from "./garment-label";

describe("garmentFor: the category decides the kind", () => {
  test("every catalog category maps to its own kind with a plain default label", () => {
    expect(garmentFor("Tops")).toEqual({ kind: "top", label: "Top" });
    expect(garmentFor("Bottoms")).toEqual({ kind: "bottoms", label: "Bottoms" });
    expect(garmentFor("Outerwear")).toEqual({ kind: "outerwear", label: "Outerwear" });
    expect(garmentFor("Dresses")).toEqual({ kind: "dress", label: "Dress" });
    expect(garmentFor("Shoes")).toEqual({ kind: "shoes", label: "Shoes" });
    expect(garmentFor("Accessories")).toEqual({ kind: "accessory", label: "Accessory" });
    expect(garmentFor("Bags")).toEqual({ kind: "bag", label: "Bag" });
    expect(garmentFor("Jewelry")).toEqual({ kind: "jewelry", label: "Jewelry" });
  });

  test("no catalog category falls through to unknown", () => {
    for (const category of CLOTHING_CATEGORIES) {
      expect(garmentFor(category).kind).not.toBe("unknown");
    }
  });

  test("category matching ignores case, spacing and singular forms", () => {
    expect(garmentFor("tops").kind).toBe("top");
    expect(garmentFor("  Dress ").kind).toBe("dress");
    expect(garmentFor("BAG").kind).toBe("bag");
    expect(garmentFor("Jewellery").kind).toBe("jewelry");
    expect(garmentFor("shoe").kind).toBe("shoes");
  });

  test("an unknown category keeps its own text as the label", () => {
    expect(garmentFor("Swimwear")).toEqual({ kind: "unknown", label: "Swimwear" });
  });

  test("a missing category reads as a piece", () => {
    expect(garmentFor(null)).toEqual({ kind: "unknown", label: "Piece" });
    expect(garmentFor(undefined)).toEqual({ kind: "unknown", label: "Piece" });
    expect(garmentFor("   ")).toEqual({ kind: "unknown", label: "Piece" });
  });

  test("title keywords never invent a kind for an unknown category", () => {
    expect(garmentFor("Swimwear", "Ribbed Bikini Top")).toEqual({
      kind: "unknown",
      label: "Swimwear",
    });
  });
});

describe("garmentFor: whole-word title keywords refine the label", () => {
  const cases: Array<[string, string, string, string]> = [
    ["Tops", "Relaxed Oxford Shirt", "top", "Shirt"],
    ["Tops", "Organic Cotton T-Shirt", "top", "T-shirt"],
    ["Tops", "Merino Crew Sweater", "top", "Sweater"],
    ["Bottoms", "High Rise Straight Jeans", "bottoms", "Jeans"],
    ["Bottoms", "Denim Mini Skirt", "bottoms", "Skirt"],
    ["Bottoms", "Linen Drawstring Shorts", "bottoms", "Shorts"],
    ["Bottoms", "Flat-Front Wool Trousers", "bottoms", "Trousers"],
    ["Outerwear", "Double-Breasted Wool Coat", "outerwear", "Coat"],
    ["Outerwear", "Quilted Puffer Vest", "outerwear", "Vest"],
    ["Outerwear", "Cropped Denim Jacket", "outerwear", "Jacket"],
    ["Shoes", "Pointed Slingback Heels", "shoes", "Heels"],
    ["Shoes", "Leather Ankle Boots", "shoes", "Boots"],
    ["Shoes", "Low-Top Canvas Sneakers", "shoes", "Sneakers"],
    ["Dresses", "Satin Slip Dress", "dress", "Dress"],
    ["Bags", "Woven Leather Tote", "bag", "Tote"],
    ["Bags", "Mini Crossbody Bag", "bag", "Bag"],
    ["Jewelry", "Gold Hoop Earrings", "jewelry", "Earrings"],
    ["Jewelry", "Fine Chain Pendant Necklace", "jewelry", "Necklace"],
    ["Jewelry", "Sterling Signet Ring", "jewelry", "Ring"],
    ["Jewelry", "Classic Leather Strap Watch", "jewelry", "Watch"],
    ["Accessories", "Ribbed Crew Socks", "accessory", "Socks"],
    ["Accessories", "Silk Neck Scarf", "accessory", "Scarf"],
    ["Accessories", "Cat-Eye Sunglasses", "accessory", "Sunglasses"],
    ["Accessories", "Washed Baseball Cap", "accessory", "Cap"],
    ["Accessories", "Wide Brim Straw Hat", "accessory", "Hat"],
    ["Accessories", "Skinny Leather Belt", "accessory", "Belt"],
    ["Accessories", "Minimal Steel Watch", "accessory", "Watch"],
  ];

  for (const [category, title, kind, label] of cases) {
    test(`${category} + "${title}" reads as ${label}`, () => {
      expect(garmentFor(category, title)).toEqual({ kind, label } as ReturnType<typeof garmentFor>);
    });
  }

  test("a known mismatch moves the kind: a clutch filed under Accessories is a bag", () => {
    expect(garmentFor("Accessories", "Satin Evening Clutch")).toEqual({
      kind: "bag",
      label: "Clutch",
    });
    expect(garmentFor("Accessories", "Leather Belt Bag")).toEqual({
      kind: "bag",
      label: "Belt bag",
    });
  });

  test("keywords only refine inside their own kind", () => {
    // "T-shirt" is a top word; on a dress it stays a dress.
    expect(garmentFor("Dresses", "Oversized T-Shirt Dress")).toEqual({
      kind: "dress",
      label: "Dress",
    });
    // "flat" and "cuff" are shoe and jewelry words, never bottoms.
    expect(garmentFor("Bottoms", "Cuffed Flat Front Chinos")).toEqual({
      kind: "bottoms",
      label: "Trousers",
    });
    // A ring-buckle belt is a belt, not jewelry.
    expect(garmentFor("Accessories", "O-Ring Buckle Belt")).toEqual({
      kind: "accessory",
      label: "Belt",
    });
  });

  test("matching is whole-word, not substring", () => {
    expect(garmentFor("Accessories", "Bagatelle Silk Scarf").label).toBe("Scarf");
    expect(garmentFor("Tops", "Shirtwaist Ribbed Top")).toEqual({ kind: "top", label: "Top" });
    expect(garmentFor("Jewelry", "Ringed Gold Cuff").label).toBe("Bracelet");
  });

  test("a title with no keyword keeps the category's default label", () => {
    expect(garmentFor("Tops", "The Everyday Layer")).toEqual({ kind: "top", label: "Top" });
    expect(garmentFor("Shoes", null)).toEqual({ kind: "shoes", label: "Shoes" });
  });
});

describe("GARMENT_KEYWORDS: the shared table mobile mirrors", () => {
  test("every word is already normalised (lowercase letters, digits and single spaces)", () => {
    for (const entry of GARMENT_KEYWORDS) {
      for (const word of entry.words) {
        expect(word).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
      }
    }
  });

  test("every entry names real kinds and a short label with no dashes a reader would see", () => {
    for (const entry of GARMENT_KEYWORDS) {
      expect(entry.within.length).toBeGreaterThan(0);
      for (const kind of entry.within) expect(GARMENT_KINDS).toContain(kind);
      if (entry.kind) expect(GARMENT_KINDS).toContain(entry.kind);
      expect(entry.kind).not.toBe("unknown");
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeLessThanOrEqual(16);
      expect(entry.label).not.toMatch(/[–—]/);
    }
  });
});

describe("copy that names the recommended piece", () => {
  test("the image alt names the product and which piece Mila means", () => {
    expect(recommendationAlt("Slim Straight Jeans", { kind: "bottoms", label: "Jeans" })).toBe(
      "Slim Straight Jeans. Mila is recommending the jeans",
    );
    expect(recommendationAlt("Boxy Tee", { kind: "top", label: "T-shirt" })).toBe(
      "Boxy Tee. Mila is recommending the t-shirt",
    );
  });

  test("the line under the photo leads with the label", () => {
    expect(garmentLine({ kind: "accessory", label: "Cap" }, "Washed Baseball Cap")).toBe(
      "Cap: Washed Baseball Cap",
    );
  });

  test("neither string uses an em-dash, an en-dash or more than one middle-dot", () => {
    const garment = garmentFor("Accessories", "Satin Evening Clutch");
    for (const text of [
      recommendationAlt("Satin Evening Clutch", garment),
      garmentLine(garment, "Satin Evening Clutch"),
    ]) {
      expect(text).not.toMatch(/[–—]/);
      expect((text.match(/·/g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("kind ordering and headings for grouped lists", () => {
  test("every kind has exactly one place in the order", () => {
    expect([...GARMENT_KIND_ORDER].sort()).toEqual([...GARMENT_KINDS].sort());
  });

  test("headings are plural and plain", () => {
    expect(garmentKindHeading("top")).toBe("Tops");
    expect(garmentKindHeading("bottoms")).toBe("Bottoms");
    expect(garmentKindHeading("dress")).toBe("Dresses");
    expect(garmentKindHeading("bag")).toBe("Bags");
    expect(garmentKindHeading("unknown")).toBe("Other pieces");
  });
});
