import { describe, expect, test } from "bun:test";
import { garmentFor, productName, type GarmentKind } from "./garment-label";

/**
 * Real catalog titles, from the products seeded by
 * supabase/migrations/20260924100000_* and 20260925140000_*. The catalog's
 * convention is "Name | Colour | Size", and the colour can itself be a
 * garment word ("Trench Coat Khaki", "Seafoam Tie Dye"). So the label comes
 * from the product name's head noun, and when the name gives no confident
 * answer, from the category. A colour word never decides it.
 *
 * FIXED and CONTROLS are copied verbatim from MILA_MOBILE
 * __tests__/garment-label-catalog-test.ts so both apps are pinned to the same
 * answers. WEB_EXTRA holds further real rows found by the web catalog audit.
 */
type Row = [category: string, title: string, label: string, kind: GarmentKind];

/** Titles the first-keyword matcher named wrongly or too vaguely (web review I1). */
const FIXED: Row[] = [
  ["Outerwear", "Baggy Chino | Trench Coat Khaki | 30L", "Outerwear", "outerwear"],
  ["Outerwear", "The Classic Shirt in Linen | Trench Coat Khaki", "Outerwear", "outerwear"],
  ["Outerwear", "The Cotton Honeycomb Square Crew | Trench Coat Khaki", "Outerwear", "outerwear"],
  ["Outerwear", "Labo Men's Mod Coat with Liner Vest", "Coat", "outerwear"],
  ["Accessories", "The Retro Jersey Short | Seafoam Tie Dye", "Accessory", "accessory"],
  ["Accessories", "Hat Bead Charm", "Charm", "accessory"],
  ["Accessories", "Hat Bead Charm Set", "Charm", "accessory"],
  ["Jewelry", "River Ear Cuff Chained Hoop", "Earrings", "jewelry"],
  ["Bottoms", "The A-Line Denim Short | Medium Indigo", "Shorts", "bottoms"],
  ["Bottoms", "The Long A-Line Denim Short | Garment-Dyed Tan", "Shorts", "bottoms"],
  ["Bottoms", "The 7” Slim-Fit Performance Chino Short | Slate Grey", "Shorts", "bottoms"],
  ["Bottoms", "The 7” Slim-Fit Performance Chino Short | Toasted Coconut", "Shorts", "bottoms"],
  ["Bottoms", "The Pull-On Performance Chino Short | Khaki", "Shorts", "bottoms"],
  ["Tops", "Kobe Men's Dri-FIT Fleece Pullover Basketball Hoodie", "Sweatshirt", "top"],
  ["Tops", "Cotton Pique Polo Shirt", "Polo", "top"],
  ["Tops", "DRY-EX Polo Shirt", "Polo", "top"],
  ["Tops", "Pique Mini Polo Shirt", "Polo", "top"],
  ["Shoes", "Studio Kitten Heel Bootie | Russet", "Boots", "shoes"],
];

/** Titles that were already right, and must stay right. */
const CONTROLS: Row[] = [
  ["Dresses", "Ailany Dress", "Dress", "dress"],
  ["Tops", "Adina Top", "Top", "top"],
  ["Bottoms", "Jeane Skirt", "Skirt", "bottoms"],
  ["Bottoms", "Slim Straight Jeans (Men's)", "Jeans", "bottoms"],
  ["Shoes", "Sandy Heeled Sandal", "Sandals", "shoes"],
  ["Jewelry", "Mini Ridge Heart Charm Pendant Necklace | 18ct Gold Plated", "Necklace", "jewelry"],
  ["Jewelry", "14K Lab Grown Diamond Circle Charm Huggies", "Earrings", "jewelry"],
  [
    "Jewelry",
    "Solid Gold Pear Diamond Charm Flat Back Stud Earring | 9ct Solid Gold",
    "Earrings",
    "jewelry",
  ],
  ["Jewelry", "14K Diamond Melbourne Cuff", "Bracelet", "jewelry"],
  ["Accessories", "Nike Everyday Elevated Crew Socks (3 Pairs)", "Socks", "accessory"],
  ["Accessories", "Evermore Solid Brass Leather Belt", "Belt", "accessory"],
  ["Accessories", "Jordan Apex Bucket Hat", "Hat", "accessory"],
  ["Accessories", "KHAITE Donna Lamb leather clutch", "Clutch", "bag"],
  ["Accessories", "Water Repellent 2-Way Shoulder Bag", "Bag", "bag"],
  ["Bags", "Nike Commuter Elite Backpack (15L)", "Backpack", "bag"],
  ["Bags", "Small System Zipper Tote", "Tote", "bag"],
  // Two garment words ending together: the longer phrase is the head noun.
  ["Bags", "Nike Heritage Tote Bag (22L)", "Tote", "bag"],
  ["Tops", "Crew Neck T-Shirt", "T-shirt", "top"],
  ["Tops", "Merino Blend Polo Cardigan | Short Sleeve", "Cardigan", "top"],
  ["Outerwear", "Trench Jacket in Double Cotton", "Jacket", "outerwear"],
  ["Outerwear", "The Oversized Blazer in Stretch Linen | Cedarwood", "Blazer", "outerwear"],
  ["Outerwear", "Lightweight Down Vest", "Vest", "outerwear"],
  ["Shoes", "Made in Italy Ballet Flat | Juniper", "Flats", "shoes"],
  ["Shoes", "The Glove Mule in ReKnit | Seagrass", "Mules", "shoes"],
  ["Bottoms", "The Chino Jogger in Buttersoft | Black", "Joggers", "bottoms"],
  ["Dresses", "Scarf-Tie Mini Dress in Silk Georgette | Men's Navy/Birch", "Dress", "dress"],
];

/** More real rows from the web audit of all 853 seeded products. */
const WEB_EXTRA: Row[] = [
  // The first matcher got these wrong too.
  ["Outerwear", "Boa Fleece Coat", "Coat", "outerwear"],
  ["Outerwear", "Nike Solo Fleece Men's Pullover Hoodie", "Outerwear", "outerwear"],
  ["Bottoms", "Wool Skirt Trousers", "Trousers", "bottoms"],
  ["Tops", "The No-Sweat Button-Down Polo | Heather Grey", "Polo", "top"],
  // The head noun after a garment-word modifier.
  ["Tops", "Luxe Fleece Crew Pullover | Deep Taupe", "Sweater", "top"],
  ["Tops", "Moisture Wicking Sweat Pad Tank Top", "Tank top", "top"],
  ["Jewelry", "Cowboy Boot Single Stud", "Earrings", "jewelry"],
  ["Jewelry", "Paisley Bandana Long Necklace", "Necklace", "jewelry"],
  ["Accessories", "Stud Belt", "Belt", "accessory"],
  ["Accessories", "The Ribbed Sweater Sock | Fuchsia Pink", "Socks", "accessory"],
  ["Bags", "Brunswick Belt Bag - Leather", "Belt bag", "bag"],
  // A garment word from another shelf, or none: the category's own word.
  ["Dresses", "The Sweater Dress in Plush Cotton | Black", "Dress", "dress"],
  ["Tops", "Cotton Slub Yarn V-Neck Vest", "Top", "top"],
  ["Tops", "Jordan Flight Club Men's Jersey", "Top", "top"],
  ["Bottoms", "Boyshorts Briefs | Line", "Bottoms", "bottoms"],
  ["Jewelry", "Agitator", "Jewelry", "jewelry"],
  ["Outerwear", "The ReNew Long Liner | Black", "Outerwear", "outerwear"],
  ["Shoes", "Air Jordan 1 Mid", "Shoes", "shoes"],
  ["Accessories", "The Supima® Boxer Brief | Uniform | Black", "Accessory", "accessory"],
  [
    "Accessories",
    "Collegium x Everlane Moc Toe Derby | Espresso Suede | Women's",
    "Accessory",
    "accessory",
  ],
];

function check(rows: Row[]) {
  for (const [category, title, label, kind] of rows) {
    test(`${category} + "${title}" -> ${label}`, () => {
      expect(garmentFor(category, title)).toEqual({ kind, label });
    });
  }
}

describe("real catalog titles the first-keyword matcher got wrong", () => {
  check(FIXED);
});

describe("real catalog titles that were already right", () => {
  check(CONTROLS);
});

describe("more real catalog titles from the web audit", () => {
  check(WEB_EXTRA);
});

describe("productName", () => {
  test("keeps only the name before the first bar", () => {
    expect(productName("Baggy Chino | Trench Coat Khaki | 30L")).toBe("Baggy Chino");
    expect(productName("The Pull-On Performance Chino Short | Khaki")).toBe(
      "The Pull-On Performance Chino Short",
    );
  });

  test("a title with no bar is its own name", () => {
    expect(productName("Hat Bead Charm")).toBe("Hat Bead Charm");
  });
});
