import { describe, expect, mock, test } from "bun:test";
import { handleLookStyleSheet, type HandleLookStyleSheetDeps } from "./style-sheet";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { InsufficientCreditsError } from "@/lib/credits";

const VALID_LOOK = {
  outfit: { headline: "H", description: "D", styling_notes: "S" },
  hair: { style: "Low bun", execution_tip: "Use a comb" },
  makeup: null,
  vibe_alignment_score: 8,
};

function fakeDeps(overrides: Partial<HandleLookStyleSheetDeps> = {}): HandleLookStyleSheetDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    renderStyleSheetForUser: mock(async () => ({
      imageDataUri: "data:image/jpeg;base64,sheet",
      mode: "style_sheet" as const,
    })),
    ...overrides,
  } as HandleLookStyleSheetDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/look/style-sheet", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/look/style-sheet", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleLookStyleSheet(postRequest({ outfit: VALID_LOOK }), deps);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the style sheet", async () => {
    const deps = fakeDeps();

    const res = await handleLookStyleSheet(postRequest({ outfit: VALID_LOOK }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mode).toBe("style_sheet");
    expect(json.imageDataUri).toBe("data:image/jpeg;base64,sheet");
    expect(deps.renderStyleSheetForUser).toHaveBeenCalledWith(
      {},
      "user-1",
      expect.objectContaining({ outfit: expect.objectContaining({ vibe_alignment_score: 8 }) }),
    );
  });

  test("no consented photo is a partial 200, not an HTTP error", async () => {
    const deps = fakeDeps({
      renderStyleSheetForUser: mock(async () => ({
        imageDataUri: null,
        mode: "unavailable" as const,
        reason: "No consented photo on file.",
      })),
    });

    const res = await handleLookStyleSheet(postRequest({ outfit: VALID_LOOK }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.imageDataUri).toBeNull();
    expect(json.mode).toBe("unavailable");
    expect(json.reason).toBe("No consented photo on file.");
  });

  test("insufficient credits -> 402 INSUFFICIENT_CREDITS", async () => {
    const deps = fakeDeps({
      renderStyleSheetForUser: mock(async () => {
        throw new InsufficientCreditsError();
      }),
    });

    const res = await handleLookStyleSheet(postRequest({ outfit: VALID_LOOK }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(402);
    expect(json.error.code).toBe("INSUFFICIENT_CREDITS");
  });

  test("invalid body -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();

    const res = await handleLookStyleSheet(postRequest({ outfit: {} }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.renderStyleSheetForUser).not.toHaveBeenCalled();
  });
});
