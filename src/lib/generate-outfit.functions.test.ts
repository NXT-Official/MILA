import { describe, expect, test } from "bun:test";
import {
  computeMakeupEligibility,
  buildDailyLookTool,
  DailyLookSchema,
} from "./generate-outfit.functions";

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
