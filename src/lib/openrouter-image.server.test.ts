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

  test("posts to the Images API with the outfit prompt and jpeg output, returns image + cost", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/images");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-key");
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("meta/muse-image");
      expect(body.output_format).toBe("jpeg");
      expect(body.prompt).toContain("The Architectural Linen Silhouette");
      return Response.json({
        data: [{ b64_json: "abc123", media_type: "image/jpeg" }],
        usage: { cost: 0.0042, prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 },
      });
    }) as unknown as typeof fetch;

    await expect(generateOutfitImage(outfit)).resolves.toEqual({
      imageUrl: "data:image/jpeg;base64,abc123",
      model: "meta/muse-image",
      costUsd: 0.0042,
      promptTokens: 120,
      completionTokens: 340,
      totalTokens: 460,
    });
  });

  test("includes exact height in cm and feet/inches when provided", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.prompt).toContain("exactly 175cm tall (5'9\")");
      return Response.json({ data: [{ b64_json: "abc123", media_type: "image/jpeg" }] });
    }) as unknown as typeof fetch;

    await generateOutfitImage(outfit, { heightCm: 175 });
  });

  test("omits height line when heightCm is not provided", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.prompt).not.toContain("tall (");
      return Response.json({ data: [{ b64_json: "abc123", media_type: "image/jpeg" }] });
    }) as unknown as typeof fetch;

    await generateOutfitImage(outfit);
  });

  test("returns null cost and token counts when OpenRouter omits usage", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(async () =>
      Response.json({ data: [{ b64_json: "abc123", media_type: "image/jpeg" }] }),
    ) as unknown as typeof fetch;

    await expect(generateOutfitImage(outfit)).resolves.toEqual({
      imageUrl: "data:image/jpeg;base64,abc123",
      model: "meta/muse-image",
      costUsd: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
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
    globalThis.fetch = mock(async () => Response.json({ data: [] })) as unknown as typeof fetch;
    await expect(generateOutfitImage(outfit)).rejects.toThrow("did not return an image");
  });

  test("includes the planned key pieces in the prompt and excludes the similar shelf", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const lookWithPicks: DailyLook = {
      ...outfit,
      shoppable_picks: [
        {
          id: "prod-1",
          title: "Adina Top",
          brand_id: "b1",
          category: "Tops",
          price: 148,
          currency: "USD",
          image_url: null,
          affiliate_link: "https://shop.example.com/prod-1",
          verification_status: "verified",
          last_verified_at: null,
          rationale: "Neckline balances a heart face shape.",
          source: "planned",
        },
        {
          id: "prod-2",
          title: "Dia Bag",
          brand_id: "b1",
          category: "Bags",
          price: 96,
          currency: "USD",
          image_url: null,
          affiliate_link: "https://shop.example.com/prod-2",
          verification_status: "verified",
          last_verified_at: null,
          rationale: "Similar to the bag in today's look.",
          source: "similar",
        },
      ],
    };

    let capturedPrompt = "";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedPrompt = JSON.parse(init?.body as string).prompt;
      return Response.json({ data: [{ b64_json: "abc123", media_type: "image/jpeg" }] });
    }) as unknown as typeof fetch;

    await generateOutfitImage(lookWithPicks);
    expect(capturedPrompt).toContain("Wear exactly these real pieces");
    expect(capturedPrompt).toContain("Adina Top");
    expect(capturedPrompt).not.toContain("Dia Bag");
  });

  test("protects the pieces block from truncation even when the outfit description is very long", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const longOutfit: DailyLook = {
      ...outfit,
      outfit: {
        ...outfit.outfit,
        description: "structured linen blazer ".repeat(200),
      },
      shoppable_picks: [
        {
          id: "prod-1",
          title: "Adina Top",
          brand_id: "b1",
          category: "Tops",
          price: 148,
          currency: "USD",
          image_url: null,
          affiliate_link: "https://shop.example.com/prod-1",
          verification_status: "verified",
          last_verified_at: null,
          rationale: "Neckline balances a heart face shape.",
          source: "planned",
        },
      ],
    };

    let capturedPrompt = "";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedPrompt = JSON.parse(init?.body as string).prompt;
      return Response.json({ data: [{ b64_json: "abc123", media_type: "image/jpeg" }] });
    }) as unknown as typeof fetch;

    await generateOutfitImage(longOutfit);
    expect(capturedPrompt).toContain("Tops: Adina Top");
    expect(capturedPrompt.length).toBeLessThanOrEqual(2048);
  });

  test("uses fallbackGenderDirection for the presentation line when gender is absent", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let capturedPrompt = "";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedPrompt = JSON.parse(init?.body as string).prompt;
      return Response.json({ data: [{ b64_json: "abc123", media_type: "image/jpeg" }] });
    }) as unknown as typeof fetch;

    await generateOutfitImage(outfit, { fallbackGenderDirection: "Male" });
    expect(capturedPrompt).toContain("presenting as male");
  });

  test("an explicit gender takes priority over fallbackGenderDirection", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let capturedPrompt = "";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedPrompt = JSON.parse(init?.body as string).prompt;
      return Response.json({ data: [{ b64_json: "abc123", media_type: "image/jpeg" }] });
    }) as unknown as typeof fetch;

    await generateOutfitImage(outfit, { gender: "Female", fallbackGenderDirection: "Male" });
    expect(capturedPrompt).toContain("presenting as female");
    expect(capturedPrompt).not.toContain("presenting as male");
  });

  test("renders neutrally when neither gender nor fallbackGenderDirection is set", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let capturedPrompt = "";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedPrompt = JSON.parse(init?.body as string).prompt;
      return Response.json({ data: [{ b64_json: "abc123", media_type: "image/jpeg" }] });
    }) as unknown as typeof fetch;

    await generateOutfitImage(outfit);
    expect(capturedPrompt).not.toContain("presenting as");
  });

  test("omits the key pieces line when the look carries no planned picks", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let capturedPrompt = "";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedPrompt = JSON.parse(init?.body as string).prompt;
      return Response.json({ data: [{ b64_json: "abc123", media_type: "image/jpeg" }] });
    }) as unknown as typeof fetch;

    await generateOutfitImage(outfit);
    expect(capturedPrompt).not.toContain("Wear exactly these real pieces");
  });
});
