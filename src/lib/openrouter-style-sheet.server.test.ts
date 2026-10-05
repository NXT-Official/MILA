import { describe, expect, test } from "bun:test";
import {
  buildStyleSheetPrompt,
  buildWardrobeLine,
  isFaceObscuringAccessory,
} from "./openrouter-style-sheet.server";
import type { DailyLook, ShoppablePick } from "./generate-outfit.functions";
import { STYLE_SHEET_QA_PROMPT } from "@/server/services/style-sheet";

const outfit = {
  outfit: {
    headline: "Two cool blues",
    description: "Linen open over a polo.",
    styling_notes: "",
  },
  hair: { style: "Low taper", execution_tip: "Sea salt spray" },
  makeup: null,
  vibe_alignment_score: 5,
} as unknown as DailyLook;

function pick(title: string, category: string, source?: "planned" | "similar"): ShoppablePick {
  return {
    id: title,
    title,
    brand_id: "brand",
    category,
    price: 10,
    currency: "USD",
    image_url: null,
    affiliate_link: "https://example.com",
    verification_status: "checked",
    last_verified_at: null,
    rationale: "r",
    ...(source ? { source } : {}),
  };
}

describe("isFaceObscuringAccessory", () => {
  test("true for the catalog's headwear and eyewear titles", () => {
    for (const title of [
      "Nike Storm-FIT ADV Club Structured AeroBill Cap",
      "Water Repellent Bucket Hat",
      "The Cashmere Ribbed Beanie | Black",
      "Wool Beret",
      "Nike Dri-FIT ADV Ace Visor",
      "Everlane x Peace & Quiet Baseball Hat | Wine",
      "Wide Brim Ecuador Hat",
      "Acetate Sunglasses",
    ]) {
      expect(isFaceObscuringAccessory(title)).toBe(true);
    }
  });

  test("false for neck and body accessories", () => {
    for (const title of [
      "The Cabin Scarf | Taupe Melange",
      "Everlane x Peace & Quiet Silk Bandana | Bone",
      "The Studio Bag",
      "Polished-leather Loafers",
      "Mens Interlocking Link Chain Necklace | Sterling Silver",
    ]) {
      expect(isFaceObscuringAccessory(title)).toBe(false);
    }
  });
});

describe("buildWardrobeLine", () => {
  test("drops headwear from the worn pieces but keeps everything else", () => {
    const line = buildWardrobeLine(outfit, [
      pick("The Classic Short-Sleeve Shirt in Linen | Light Blue", "Tops"),
      pick("Water Repellent Bucket Hat", "Accessories"),
      pick("Polished-leather Loafers", "Shoes"),
      pick("The Studio Bag", "Accessories"),
      pick("Ribbed Cotton Tank Top", "Tops", "similar"),
    ]);
    expect(line).toContain("The Classic Short-Sleeve Shirt in Linen");
    expect(line).toContain("Polished-leather Loafers");
    expect(line).toContain("The Studio Bag");
    expect(line).not.toContain("Bucket Hat");
    // "similar" pieces were never worn; keep that behaviour pinned too.
    expect(line).not.toContain("Ribbed Cotton Tank Top");
  });

  test("an all-headwear wardrobe falls back to the outfit text alone", () => {
    const line = buildWardrobeLine(outfit, [pick("Water Repellent Bucket Hat", "Accessories")]);
    expect(line).toBe(`${outfit.outfit.headline}: ${outfit.outfit.description}`);
  });
});

describe("buildStyleSheetPrompt", () => {
  test("keeps the head bare and never wears the hat, even when the outfit mentions one", () => {
    const prompt = buildStyleSheetPrompt({
      outfit: {
        ...outfit,
        outfit: {
          ...outfit.outfit,
          headline: "Rain handled by the hat",
          description: "Rain handled by the hat over a light coat.",
        },
      } as unknown as DailyLook,
      shoppablePicks: [pick("Water Repellent Bucket Hat", "Accessories")],
      gender: "Male",
    });
    expect(prompt).toContain("HEADWEAR OVERRIDE");
    expect(prompt).toContain("KEEP THE HEAD BARE IN EVERY VIEW");
    expect(prompt).toContain("even if the recommended outfit below mentions a hat");
    expect(prompt).not.toContain("Water Repellent Bucket Hat");
  });

  test("the headwear override survives the 4096-char prompt slice even with a long outfit", () => {
    // The template is sliced at MAX_PROMPT_LENGTH; the tail (NEGATIVE
    // CONSTRAINTS, OUTPUT) is already cut for long outfits, so anything the
    // render must obey has to sit near the top. This failed the first time:
    // the override was in the WARDROBE block and a long description cut it.
    const prompt = buildStyleSheetPrompt({
      outfit: {
        ...outfit,
        outfit: { ...outfit.outfit, description: "D".repeat(2900) },
      } as unknown as DailyLook,
      shoppablePicks: [],
      gender: "Male",
    });
    expect(prompt.length).toBe(4096);
    expect(prompt).toContain("HEADWEAR OVERRIDE");
  });
});

describe("STYLE_SHEET_QA_PROMPT", () => {
  test("tolerates the deliberately bare head but keeps identity checks strict", () => {
    expect(STYLE_SHEET_QA_PROMPT).toContain("deliberately shows NO headwear");
    expect(STYLE_SHEET_QA_PROMPT).toContain("never fail a sheet because a hat");
    expect(STYLE_SHEET_QA_PROMPT).toContain("same face, skin tone, hair");
    expect(STYLE_SHEET_QA_PROMPT).toContain("or when a garment named in the outfit is missing");
  });
});
