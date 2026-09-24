import { afterEach, describe, expect, mock, test } from "bun:test";
import { ImageProviderRateLimitError } from "./openrouter-image.server";
import {
  editOutfitPhoto,
  PHOTO_EDIT_MODEL,
  PHOTO_EDIT_PROVIDER,
} from "./openrouter-photo-edit.server";
import type { RateLimitStore } from "@/lib/rate-limit.server";
import type { DailyLook } from "./generate-outfit.functions";

const outfit: DailyLook = {
  outfit: {
    headline: "The Architectural Linen Silhouette",
    description: "A structured linen blazer over a silk camisole with wide-leg trousers.",
    styling_notes: "Roll cuffs, half-tuck the camisole.",
  },
  hair: { style: "Low sleek bun.", execution_tip: "Prep with mid-weight texture spray." },
  makeup: { palette: "Warm Autumn glow.", details: "Dewy base, terracotta cream blush." },
  vibe_alignment_score: 9,
};

const userPhoto = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };

const allowStore: RateLimitStore = async () => ({
  allowed: true,
  remaining: 99,
  reset_at: new Date().toISOString(),
  retry_after_seconds: 0,
});

const denyStore: RateLimitStore = async () => ({
  allowed: false,
  remaining: 0,
  reset_at: new Date().toISOString(),
  retry_after_seconds: 3_600,
});

const originalKey = process.env.OPENROUTER_API_KEY;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

function editArgs() {
  return {
    userPhoto,
    referenceImages: [],
    outfit,
    makeupEnabled: false,
    hairLength: "Medium",
    gender: "Female",
  };
}

describe("OpenRouter photo edit (image-to-image, meta/muse-image)", () => {
  test("exports model/provider matching the text-to-image path", () => {
    expect(PHOTO_EDIT_PROVIDER).toBe("openrouter");
    expect(PHOTO_EDIT_MODEL).toBe("meta/muse-image");
  });

  test("throws when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(editOutfitPhoto(editArgs(), { rateLimitStore: allowStore })).rejects.toThrow(
      "Missing environment variable",
    );
  });

  test("posts to the Images API with prompt, input_references, and jpeg output", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/images");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-key");
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("meta/muse-image");
      expect(body.output_format).toBe("jpeg");
      expect(body.prompt).toContain("The Architectural Linen Silhouette");
      expect(body.prompt).toContain("female-presenting");
      expect(body.input_references).toEqual([
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" } },
        { type: "image_url", image_url: { url: "data:image/png;base64,BA==" } },
      ]);
      return Response.json({
        data: [{ b64_json: "edited123", media_type: "image/jpeg" }],
        usage: { cost: 0.01 },
      });
    }) as unknown as typeof fetch;

    const result = await editOutfitPhoto(
      {
        ...editArgs(),
        referenceImages: [{ bytes: new Uint8Array([4]), contentType: "image/png" }],
      },
      { rateLimitStore: allowStore },
    );

    expect(result).toEqual({ imageUrl: "data:image/jpeg;base64,edited123", costUsd: 0.01 });
  });

  test("keeps the identity/gender lock intact even when the garment description is near the field max", async () => {
    // Confirmed live in production: with the identity-lock line placed in the
    // truncatable portion of the prompt, a long AI-composed description could
    // push it past the 2048-char cutoff entirely, and the model would
    // generate a person of the wrong apparent gender with no instruction
    // telling it not to. This proves the fix: the lock line must survive
    // regardless of how long the variable content is.
    process.env.OPENROUTER_API_KEY = "test-key";
    const longOutfit: DailyLook = {
      ...outfit,
      outfit: {
        ...outfit.outfit,
        description:
          "A structured linen blazer over a silk camisole with wide-leg trousers. ".repeat(15),
      },
    };
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.prompt.length).toBeLessThanOrEqual(2048);
      expect(body.prompt).toContain("female-presenting");
      expect(body.prompt).toContain("never shift apparent gender");
      expect(body.prompt).toContain("Avoid:");
      return Response.json({
        data: [{ b64_json: "edited123", media_type: "image/jpeg" }],
        usage: { cost: 0.01 },
      });
    }) as unknown as typeof fetch;

    await editOutfitPhoto({ ...editArgs(), outfit: longOutfit }, { rateLimitStore: allowStore });
  });

  test("caps reference images at 3 even when more are given", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let capturedReferences: Array<Record<string, unknown>> | undefined;
    globalThis.fetch = mock(async (_url, init?: RequestInit) => {
      capturedReferences = JSON.parse(init?.body as string).input_references;
      return Response.json({ data: [{ b64_json: "x", media_type: "image/jpeg" }] });
    }) as unknown as typeof fetch;

    await editOutfitPhoto(
      {
        ...editArgs(),
        referenceImages: [
          { bytes: new Uint8Array([1]), contentType: "image/png" },
          { bytes: new Uint8Array([2]), contentType: "image/png" },
          { bytes: new Uint8Array([3]), contentType: "image/png" },
          { bytes: new Uint8Array([4]), contentType: "image/png" },
        ],
      },
      { rateLimitStore: allowStore },
    );

    // 1 user photo + capped at 3 references = 4
    expect(capturedReferences?.length).toBe(4);
  });

  test("returns null cost when OpenRouter omits usage", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(async () =>
      Response.json({ data: [{ b64_json: "x", media_type: "image/jpeg" }] }),
    ) as unknown as typeof fetch;

    await expect(editOutfitPhoto(editArgs(), { rateLimitStore: allowStore })).resolves.toEqual({
      imageUrl: "data:image/jpeg;base64,x",
      costUsd: null,
    });
  });

  test("throws ImageProviderRateLimitError when the site-wide daily quota is exhausted", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(async () => {
      throw new Error("must not call OpenRouter once the daily quota is exhausted");
    }) as unknown as typeof fetch;
    await expect(editOutfitPhoto(editArgs(), { rateLimitStore: denyStore })).rejects.toThrow(
      ImageProviderRateLimitError,
    );
  });

  test("throws ImageProviderRateLimitError on 429", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(
      async () => new Response("slow down", { status: 429 }),
    ) as unknown as typeof fetch;
    await expect(editOutfitPhoto(editArgs(), { rateLimitStore: allowStore })).rejects.toThrow(
      ImageProviderRateLimitError,
    );
  });

  test("throws on non-OK status", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(
      async () => new Response("boom", { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(editOutfitPhoto(editArgs(), { rateLimitStore: allowStore })).rejects.toThrow(
      "OpenRouter photo-edit request failed",
    );
  });

  test("throws when the response has no image", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(async () => Response.json({ data: [] })) as unknown as typeof fetch;
    await expect(editOutfitPhoto(editArgs(), { rateLimitStore: allowStore })).rejects.toThrow(
      "did not return an edited image",
    );
  });
});
