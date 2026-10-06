import { describe, expect, test } from "bun:test";
import { ClothingAttributesSchema } from "@/lib/outfit-items";
import { CLOTHING_CATEGORIES } from "./wardrobe";

/** The category spellings the products table carries. The classifier can only
 * ever answer with a value from CLOTHING_CATEGORIES, so any catalogue category
 * missing here is a category no photographed piece can match. */
const CATALOGUE_CATEGORIES = [
  "Tops",
  "Bottoms",
  "Outerwear",
  "Dresses",
  "Shoes",
  "Accessories",
  "Bags",
  "Jewelry",
];

function attributes(category: string) {
  return {
    name: "Cream quilted top-handle piece",
    category,
    primary_color: "Cream",
    color_undertone: "Warm",
    silhouette_tags: ["quilted", "top-handle"],
  };
}

describe("CLOTHING_CATEGORIES", () => {
  test("offers every category the catalogue carries", () => {
    for (const category of CATALOGUE_CATEGORIES) {
      expect(CLOTHING_CATEGORIES as readonly string[]).toContain(category);
    }
  });
});

describe("ClothingAttributesSchema category", () => {
  test("accepts every catalogue category", () => {
    for (const category of CATALOGUE_CATEGORIES) {
      expect(ClothingAttributesSchema.safeParse(attributes(category)).success).toBe(true);
    }
  });

  test("still rejects a category the catalogue does not have", () => {
    expect(ClothingAttributesSchema.safeParse(attributes("Spacesuit")).success).toBe(false);
  });
});
