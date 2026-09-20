import { describe, expect, mock, test } from "bun:test";
import { handleLookPhotoPreview, type HandleLookPhotoPreviewDeps } from "./photo-preview";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { InsufficientCreditsError } from "@/lib/credits";

const VALID_LOOK = {
  outfit: { headline: "H", description: "D", styling_notes: "S" },
  hair: { style: "Low bun", execution_tip: "Use a comb" },
  makeup: null,
  vibe_alignment_score: 8,
};

function fakeDeps(
  overrides: Partial<HandleLookPhotoPreviewDeps> = {},
): HandleLookPhotoPreviewDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    renderPhotoPreviewForUser: mock(async () => ({
      imageDataUri: "data:image/jpeg;base64,preview",
      mode: "photo_edit" as const,
    })),
    ...overrides,
  } as HandleLookPhotoPreviewDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/look/photo-preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/look/photo-preview", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleLookPhotoPreview(postRequest({ outfit: VALID_LOOK }), deps);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the edited preview", async () => {
    const deps = fakeDeps();

    const res = await handleLookPhotoPreview(
      postRequest({ outfit: VALID_LOOK }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mode).toBe("photo_edit");
    expect(json.imageDataUri).toBe("data:image/jpeg;base64,preview");
    expect(deps.renderPhotoPreviewForUser).toHaveBeenCalledWith(
      {},
      "user-1",
      expect.objectContaining({ outfit: expect.objectContaining({ vibe_alignment_score: 8 }) }),
    );
  });

  test("no consented photo is a partial 200, not an HTTP error", async () => {
    const deps = fakeDeps({
      renderPhotoPreviewForUser: mock(async () => ({
        imageDataUri: null,
        mode: "unavailable" as const,
        reason: "No consented photo on file.",
      })),
    });

    const res = await handleLookPhotoPreview(
      postRequest({ outfit: VALID_LOOK }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.imageDataUri).toBeNull();
    expect(json.mode).toBe("unavailable");
    expect(json.reason).toBe("No consented photo on file.");
  });

  test("insufficient credits -> 402 INSUFFICIENT_CREDITS", async () => {
    const deps = fakeDeps({
      renderPhotoPreviewForUser: mock(async () => {
        throw new InsufficientCreditsError();
      }),
    });

    const res = await handleLookPhotoPreview(
      postRequest({ outfit: VALID_LOOK }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(402);
    expect(json.error.code).toBe("INSUFFICIENT_CREDITS");
  });

  test("invalid body -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();

    const res = await handleLookPhotoPreview(postRequest({ outfit: {} }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.renderPhotoPreviewForUser).not.toHaveBeenCalled();
  });
});
