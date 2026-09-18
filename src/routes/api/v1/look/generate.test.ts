import { describe, expect, mock, test } from "bun:test";
import { handleLookGenerate, type HandleLookGenerateDeps } from "./generate";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { InsufficientCreditsError } from "@/lib/credits";

const VALID_INPUT = {
  bodyType: "Hourglass",
  colorSeason: "Bright Winter",
  weather: "Sunny, 72F",
  vibe: "Work",
};

function fakeDeps(overrides: Partial<HandleLookGenerateDeps> = {}): HandleLookGenerateDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    generateLookForUser: mock(async () => ({
      outfit: { headline: "H", description: "D", styling_notes: "S" },
      hair: { style: "Low bun", execution_tip: "Use a comb" },
      makeup: null,
      vibe_alignment_score: 8,
      forecastRetrievedAt: null,
    })),
    ...overrides,
  } as HandleLookGenerateDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/look/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/look/generate", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleLookGenerate(postRequest(VALID_INPUT), deps);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the composed look", async () => {
    const deps = fakeDeps();

    const res = await handleLookGenerate(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.outfit.headline).toBe("H");
    expect(json.vibe_alignment_score).toBe(8);
    expect(deps.generateLookForUser).toHaveBeenCalledWith(
      {},
      "user-1",
      expect.objectContaining({ bodyType: "Hourglass" }),
    );
  });

  test("insufficient credits -> 402 INSUFFICIENT_CREDITS", async () => {
    const deps = fakeDeps({
      generateLookForUser: mock(async () => {
        throw new InsufficientCreditsError();
      }),
    });

    const res = await handleLookGenerate(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(402);
    expect(json.error.code).toBe("INSUFFICIENT_CREDITS");
  });

  test("invalid body -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();

    const res = await handleLookGenerate(postRequest({ bodyType: "" }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.generateLookForUser).not.toHaveBeenCalled();
  });
});
