import { afterEach, describe, expect, mock, test } from "bun:test";
import { ImageProviderRateLimitError, generateOutfitImage } from "./openrouter-image.server";
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

const originalKey = process.env.OPENROUTER_API_KEY;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

describe("OpenRouter outfit image generation", () => {
  test("throws when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(generateOutfitImage(outfit)).rejects.toThrow("Missing environment variable");
  });

  test("posts the outfit prompt and returns the image data URI", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-key");
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("meta/muse-image");
      expect(body.modalities).toEqual(["image", "text"]);
      expect(body.messages[0].content).toContain("The Architectural Linen Silhouette");
      return Response.json({
        choices: [
          { message: { images: [{ image_url: { url: "data:image/png;base64,abc123" } }] } },
        ],
      });
    }) as unknown as typeof fetch;

    await expect(generateOutfitImage(outfit)).resolves.toBe("data:image/png;base64,abc123");
  });

  test("throws ImageProviderRateLimitError on 429", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(
      async () => new Response("slow down", { status: 429 }),
    ) as unknown as typeof fetch;
    await expect(generateOutfitImage(outfit)).rejects.toThrow(ImageProviderRateLimitError);
  });

  test("throws on non-OK status", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(
      async () => new Response("boom", { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(generateOutfitImage(outfit)).rejects.toThrow("OpenRouter image request failed");
  });

  test("throws when the response has no image", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(async () =>
      Response.json({ choices: [{ message: { content: "I couldn't render that." } }] }),
    ) as unknown as typeof fetch;
    await expect(generateOutfitImage(outfit)).rejects.toThrow("did not return an image");
  });
});
