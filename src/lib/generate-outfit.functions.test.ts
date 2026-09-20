import { describe, expect, test } from "bun:test";
import {
  computeMakeupEligibility,
  buildDailyLookTool,
  DailyLookSchema,
  hydrateShoppablePicks,
} from "./generate-outfit.functions";
import type { LookProduct } from "./look-products.functions";

describe("computeMakeupEligibility", () => {
  test("Male is always disabled, regardless of makeup_preference", () => {
    expect(computeMakeupEligibility({ gender: "Male", makeup_preference: "defined" })).toBe(false);
    expect(computeMakeupEligibility({ gender: "Male", makeup_preference: null })).toBe(false);
  });

  test("non-Male with missing or 'none' preference is disabled", () => {
    expect(computeMakeupEligibility({ gender: "Female", makeup_preference: null })).toBe(false);
    expect(computeMakeupEligibility({ gender: "Female", makeup_preference: "none" })).toBe(false);
    expect(computeMakeupEligibility({ gender: "Non-binary", makeup_preference: undefined })).toBe(
      false,
    );
  });

  test("non-Male with an explicit non-'none' preference is enabled", () => {
    expect(computeMakeupEligibility({ gender: "Female", makeup_preference: "natural" })).toBe(true);
    expect(
      computeMakeupEligibility({ gender: "Prefer not to say", makeup_preference: "minimal" }),
    ).toBe(true);
  });
});

describe("buildDailyLookTool", () => {
  test("omits makeup entirely from the schema when disabled", () => {
    const tool = buildDailyLookTool(false);
    const params = tool.function.parameters;
    expect(params.properties).not.toHaveProperty("makeup");
    expect(params.required).not.toContain("makeup");
  });

  test("includes makeup in the schema when enabled", () => {
    const tool = buildDailyLookTool(true);
    const params = tool.function.parameters;
    expect(params.properties).toHaveProperty("makeup");
    expect(params.required).toContain("makeup");
  });

  test("omits shoppable_picks when no candidate products exist", () => {
    const tool = buildDailyLookTool(false, []);
    const params = tool.function.parameters;
    expect(params.properties).not.toHaveProperty("shoppable_picks");
    expect(params.required).not.toContain("shoppable_picks");
  });

  test("constrains shoppable_picks.product_id to the exact candidate id enum", () => {
    const tool = buildDailyLookTool(false, ["prod-1", "prod-2"]);
    const params = tool.function.parameters as {
      properties: {
        shoppable_picks: { items: { properties: { product_id: { enum: string[] } } } };
      };
      required: string[];
    };
    expect(params.properties.shoppable_picks.items.properties.product_id.enum).toEqual([
      "prod-1",
      "prod-2",
    ]);
    expect(params.required).toContain("shoppable_picks");
  });
});

describe("hydrateShoppablePicks", () => {
  const candidates: LookProduct[] = [
    {
      id: "prod-1",
      title: "Structured Linen Blazer",
      brand_id: "brand-1",
      category: "Outerwear",
      price: 128,
      currency: "USD",
      image_url: null,
      affiliate_link: "https://shop.example.com/prod-1",
      verification_status: "verified",
      last_verified_at: "2026-09-01T00:00:00.000Z",
    },
  ];

  test("hydrates a real product_id into the full real product row", () => {
    const result = hydrateShoppablePicks(
      [{ product_id: "prod-1", rationale: "Balances a round face with structured shoulders." }],
      candidates,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "prod-1",
      title: "Structured Linen Blazer",
      price: 128,
      affiliate_link: "https://shop.example.com/prod-1",
      rationale: "Balances a round face with structured shoulders.",
    });
  });

  test("drops a hallucinated product_id that isn't a real candidate", () => {
    const result = hydrateShoppablePicks(
      [{ product_id: "invented-id", rationale: "This item doesn't exist." }],
      candidates,
    );
    expect(result).toEqual([]);
  });

  test("returns an empty array when shoppable_picks is missing or malformed", () => {
    expect(hydrateShoppablePicks(undefined, candidates)).toEqual([]);
    expect(hydrateShoppablePicks("not an array", candidates)).toEqual([]);
  });
});

const baseArgs = {
  outfit: { headline: "H", description: "D", styling_notes: "S" },
  hair: { style: "Low bun", execution_tip: "Use a comb" },
  vibe_alignment_score: 8,
};

describe("DailyLookSchema makeup nullability", () => {
  test("accepts an explicit null makeup (disabled path)", () => {
    const result = DailyLookSchema.safeParse({ ...baseArgs, makeup: null });
    expect(result.success).toBe(true);
    expect(result.success && result.data.makeup).toBeNull();
  });

  test("accepts a populated makeup object (enabled path)", () => {
    const result = DailyLookSchema.safeParse({
      ...baseArgs,
      makeup: { palette: "Warm Autumn glow", details: "Dewy base" },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.makeup?.palette).toBe("Warm Autumn glow");
  });

  test("rejects a missing makeup key — callers must force it to null or an object", () => {
    const result = DailyLookSchema.safeParse(baseArgs);
    expect(result.success).toBe(false);
  });
});
