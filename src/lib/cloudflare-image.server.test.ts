import { afterEach, describe, expect, mock, test } from "bun:test";
import { ImageProviderRateLimitError, generateOutfitImage } from "./cloudflare-image.server";
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

const originalAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const originalToken = process.env.CLOUDFLARE_API_TOKEN;
const originalFetch = globalThis.fetch;

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

function setEnv() {
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
  else process.env.CLOUDFLARE_ACCOUNT_ID = originalAccountId;
  if (originalToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
  else process.env.CLOUDFLARE_API_TOKEN = originalToken;
});

describe("Cloudflare Workers AI outfit image generation", () => {
  test("throws when credentials are missing", async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    await expect(generateOutfitImage(outfit)).rejects.toThrow("Missing environment variable");
  });

  test("posts the outfit prompt with 4 steps and returns a data URI at zero cost", async () => {
    setEnv();
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/@cf/black-forest-labs/flux-1-schnell",
      );
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-token");
      expect(headers.Accept).toBe("application/json");
      const body = JSON.parse(init?.body as string);
      expect(body.steps).toBe(4);
      expect(body.prompt).toContain("The Architectural Linen Silhouette");
      return Response.json({ result: { image: "abc123" }, success: true });
    }) as unknown as typeof fetch;

    await expect(generateOutfitImage(outfit, { rateLimitStore: allowStore })).resolves.toEqual({
      imageUrl: "data:image/jpeg;base64,abc123",
      costUsd: 0,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });

  test("throws ImageProviderRateLimitError on 429", async () => {
    setEnv();
    globalThis.fetch = mock(
      async () => new Response("slow down", { status: 429 }),
    ) as unknown as typeof fetch;
    await expect(generateOutfitImage(outfit, { rateLimitStore: allowStore })).rejects.toThrow(
      ImageProviderRateLimitError,
    );
  });

  test("throws ImageProviderRateLimitError when the site-wide daily quota is exhausted", async () => {
    setEnv();
    globalThis.fetch = mock(async () => {
      throw new Error("must not call Cloudflare once the daily quota is exhausted");
    }) as unknown as typeof fetch;
    await expect(generateOutfitImage(outfit, { rateLimitStore: denyStore })).rejects.toThrow(
      ImageProviderRateLimitError,
    );
  });

  test("throws on non-OK status", async () => {
    setEnv();
    globalThis.fetch = mock(
      async () => new Response("boom", { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(generateOutfitImage(outfit, { rateLimitStore: allowStore })).rejects.toThrow(
      "Cloudflare image request failed",
    );
  });

  test("throws when the provider envelope reports failure", async () => {
    setEnv();
    globalThis.fetch = mock(async () =>
      Response.json({ success: false, errors: [{ message: "model unavailable" }] }),
    ) as unknown as typeof fetch;
    await expect(generateOutfitImage(outfit, { rateLimitStore: allowStore })).rejects.toThrow(
      "model unavailable",
    );
  });

  test("throws when the response has no image", async () => {
    setEnv();
    globalThis.fetch = mock(async () =>
      Response.json({ success: true, result: {} }),
    ) as unknown as typeof fetch;
    await expect(generateOutfitImage(outfit, { rateLimitStore: allowStore })).rejects.toThrow(
      "did not return an image",
    );
  });
});
