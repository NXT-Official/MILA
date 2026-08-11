import { describe, expect, test } from "bun:test";
import { dossierCompletion, isStyleProfileComplete, toStyleProfileRow } from "./completion";
import type { DashboardProfile } from "@/lib/queries/profile";

const FULL: DashboardProfile = {
  body_type: "Hourglass",
  color_season: "Spring Light",
  color_season_base: "Spring",
  skin_undertone: "Warm",
  full_name: "Test Member",
  face_shape: "Oval",
  hair_type: "Wavy",
  beauty_preferences: ["Minimal"],
  color_profile: { season: "Spring" },
  default_location: "paris",
};

describe("dossierCompletion", () => {
  test("a fully filled dossier reads 100% with nothing missing", () => {
    expect(dossierCompletion(FULL)).toEqual({
      filled: 8,
      total: 8,
      percent: 100,
      missing: [],
    });
  });

  test("optional signals are the only thing left once onboarding's gate is passed", () => {
    const result = dossierCompletion({ ...FULL, beauty_preferences: [], default_location: null });
    expect(result.missing).toEqual(["Beauty preferences", "Home city"]);
    expect(result.percent).toBe(75);
    // The required six are still complete, so the app still lets them generate.
    expect(isStyleProfileComplete(toStyleProfileRow(FULL))).toBe(true);
  });

  test("an empty profile is 0% and every signal is named", () => {
    const result = dossierCompletion(null);
    expect(result.percent).toBe(0);
    expect(result.missing).toHaveLength(8);
  });

  test("unrecognized values do not count as filled", () => {
    const result = dossierCompletion({ ...FULL, body_type: "Trapezoid", face_shape: "" });
    expect(result.missing).toEqual(["Body silhouette", "Face shape"]);
    expect(result.percent).toBe(75);
  });

  test("a whitespace-only home city is not a home city", () => {
    expect(dossierCompletion({ ...FULL, default_location: "   " }).missing).toEqual(["Home city"]);
  });
});
