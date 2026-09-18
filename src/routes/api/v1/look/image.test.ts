import { describe, expect, mock, test } from "bun:test";
import { handleLookImage, type HandleLookImageDeps } from "./image";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";

const VALID_LOOK = {
  outfit: { headline: "H", description: "D", styling_notes: "S" },
  hair: { style: "Low bun", execution_tip: "Use a comb" },
  makeup: null,
  vibe_alignment_score: 8,
};

function fakeDeps(overrides: Partial<HandleLookImageDeps> = {}): HandleLookImageDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    renderLookImageForUser: mock(async () => ({ imageDataUri: "data:image/png;base64,abc" })),
    ...overrides,
  } as HandleLookImageDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/look/image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/look/image", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleLookImage(postRequest(VALID_LOOK), deps);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the rendered image", async () => {
    const deps = fakeDeps();

    const res = await handleLookImage(postRequest(VALID_LOOK, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.imageDataUri).toBe("data:image/png;base64,abc");
  });

  test("provider failure is a partial 200, not an HTTP error", async () => {
    const deps = fakeDeps({
      renderLookImageForUser: mock(async () => ({
        imageDataUri: null,
        imageGenerationError: "The outfit was created, but its visual could not be generated.",
      })),
    });

    const res = await handleLookImage(postRequest(VALID_LOOK, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.imageDataUri).toBeNull();
    expect(json.imageGenerationError).toContain("could not be generated");
  });

  test("invalid body -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();

    const res = await handleLookImage(postRequest({ outfit: {} }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.renderLookImageForUser).not.toHaveBeenCalled();
  });
});
