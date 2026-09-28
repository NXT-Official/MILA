import { describe, expect, test } from "bun:test";
import {
  CLIMATE_RULES,
  computeMakeupEligibility,
  buildDailyLookTool,
  buildInventoryReviewPrompt,
  buildInventoryReviewTool,
  buildOutfitPlanPrompt,
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
      // Hydrated picks are the composed outfit's pieces — always "planned"
      // shelving, so the "similar" additions look.ts adds stay distinguishable.
      source: "planned",
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

describe("DailyLookSchema fallback_gender_direction", () => {
  test("accepts Male, Female, null, or a missing value", () => {
    for (const value of ["Male", "Female", null, undefined] as const) {
      const result = DailyLookSchema.safeParse({
        ...baseArgs,
        makeup: null,
        ...(value !== undefined ? { fallback_gender_direction: value } : {}),
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.fallback_gender_direction).toBe(value);
    }
  });

  test("rejects an unknown direction", () => {
    const result = DailyLookSchema.safeParse({
      ...baseArgs,
      makeup: null,
      fallback_gender_direction: "Non-binary",
    });
    expect(result.success).toBe(false);
  });
});

describe("buildInventoryReviewTool", () => {
  test("constrains item to integer indexes within the inventory range", () => {
    const tool = buildInventoryReviewTool(851);
    const params = tool.function.parameters as {
      properties: {
        shortlist: {
          items: {
            properties: { item: { type: string; minimum: number; maximum: number } };
          };
        };
      };
      required: string[];
    };
    expect(tool.function.name).toBe("report_inventory_shortlist");
    const item = params.properties.shortlist.items.properties.item;
    expect(item.type).toBe("integer");
    expect(item.minimum).toBe(0);
    expect(item.maximum).toBe(851);
    expect(params.required).toEqual(["shortlist"]);
  });
});

describe("prompt builders", () => {
  const weatherBlock =
    "LOCAL WEATHER (authoritative — do not override):\n- Temperature: 64°F (18°C)";

  test("buildInventoryReviewPrompt embeds the profile, vibe, count, numbered inventory, and shared climate rules", () => {
    const prompt = buildInventoryReviewPrompt({
      profileLines: "- Body type: Hourglass",
      weatherBlock,
      agendaBlock: "",
      vibe: "Work",
      inventoryCount: 2,
      inventoryBlock: "### Tops\n0 | Adina Top | 148 USD",
    });
    expect(prompt).toContain("- Body type: Hourglass");
    expect(prompt).toContain("OCCASION VIBE: Work");
    expect(prompt).toContain("### Tops\n0 | Adina Top | 148 USD");
    expect(prompt).toContain("THE LIVE SHOP INVENTORY (2 numbered rows");
    expect(prompt).toContain(CLIMATE_RULES);
  });

  test("buildOutfitPlanPrompt composes only from the shortlist and shares the climate rules", () => {
    const prompt = buildOutfitPlanPrompt({
      profileLines: "- Body type: Hourglass",
      weatherBlock,
      agendaBlock: "",
      vibe: "Work",
      colorSeason: "Warm Autumn",
      bodyType: "Hourglass",
      skinDepth: "Medium",
      skinUndertone: "Warm",
      faceShape: "Oval",
      makeupEnabled: true,
      beautyPrefsLine: "natural finish",
      hairRule: "- HAIR: prescribe a concrete silhouette.",
      shortlistBlock: 'id="prod-1" | Tops | Adina Top | 148 USD | Cream ditsy-floral top.',
    });
    expect(prompt).toContain("COMPOSE FROM THE SHORTLIST");
    expect(prompt).toContain('id="prod-1" | Tops | Adina Top');
    expect(prompt).toContain("MUST appear in shoppable_picks");
    expect(prompt).toContain("Warm Autumn 16-season palette");
    expect(prompt).toContain('literal string "Warm Autumn"');
    expect(prompt).toContain(CLIMATE_RULES);
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

describe("DailyLookSchema shoppable pick shelving", () => {
  const pick = {
    id: "prod-1",
    title: "Structured Linen Blazer",
    brand_id: "brand-1",
    category: "Outerwear",
    price: 128,
    currency: "USD",
    image_url: null,
    affiliate_link: "https://shop.example.com/prod-1",
    verification_status: "verified",
    last_verified_at: null,
    rationale: "Structured shoulders balance a round face.",
  };

  test("accepts both shelves and a missing shelf (looks saved by older clients)", () => {
    for (const source of ["planned", "similar", undefined] as const) {
      const result = DailyLookSchema.safeParse({
        ...baseArgs,
        makeup: null,
        shoppable_picks: [{ ...pick, ...(source ? { source } : {}) }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.shoppable_picks?.[0].source).toBe(source);
      }
    }
  });

  test("rejects an unknown shelf value", () => {
    const result = DailyLookSchema.safeParse({
      ...baseArgs,
      makeup: null,
      shoppable_picks: [{ ...pick, source: "extra" }],
    });
    expect(result.success).toBe(false);
  });
});
