import { describe, expect, test } from "bun:test";
import { getInitialOnboardingStep, sanitizeRestartFlag } from "./steps";

const completeProfile = {
  skin_undertone: "Warm",
  color_season_base: "Autumn",
  color_profile: { season: "Deep Autumn" },
  body_type: "Hourglass",
  face_shape: "Oval",
  hair_type: "Straight/Fine",
  gender: "Female",
  hair_length: "Long",
  skin_depth: "Medium",
} as unknown as Parameters<typeof getInitialOnboardingStep>[0];

describe("sanitizeRestartFlag", () => {
  test("accepts the boolean and string forms a URL can carry", () => {
    expect(sanitizeRestartFlag(true)).toBe(true);
    expect(sanitizeRestartFlag("true")).toBe(true);
    expect(sanitizeRestartFlag("1")).toBe(true);
    expect(sanitizeRestartFlag(1)).toBe(true);
  });

  test("rejects anything else", () => {
    expect(sanitizeRestartFlag(undefined)).toBe(false);
    expect(sanitizeRestartFlag(false)).toBe(false);
    expect(sanitizeRestartFlag("false")).toBe(false);
    expect(sanitizeRestartFlag("yes please")).toBe(false);
  });
});

describe("getInitialOnboardingStep", () => {
  test("a restart always begins at the welcome step, even with a complete profile", () => {
    expect(getInitialOnboardingStep(completeProfile, { restart: true })).toBe("welcome");
  });

  test("without a restart, a blank profile begins at welcome", () => {
    expect(getInitialOnboardingStep(null, { restart: false })).toBe("welcome");
  });

  test("without a restart, a partial profile resumes at its first incomplete step", () => {
    const partial = { ...completeProfile, gender: null } as typeof completeProfile;
    expect(getInitialOnboardingStep(partial, { restart: false })).toBe("gender");
  });
});
