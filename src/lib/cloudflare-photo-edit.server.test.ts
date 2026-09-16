import { afterEach, describe, expect, mock, test } from "bun:test";
import { editOutfitPhoto } from "./cloudflare-photo-edit.server";
import { ImageProviderRateLimitError } from "./cloudflare-image.server";
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

describe("Cloudflare photo-edit (flux-2-klein-4b)", () => {
  test("throws when credentials are missing", async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    await expect(
      editOutfitPhoto({
        userPhoto,
        referenceImages: [],
        outfit,
        makeupEnabled: true,
        hairLength: "Medium",
        gender: null,
      }),
    ).rejects.toThrow("Missing environment variable");
  });

  test("posts multipart form with input_image_0 and up to 3 reference images", async () => {
    setEnv();
    let capturedBody: FormData | undefined;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/@cf/black-forest-labs/flux-2-klein-4b",
      );
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-token");
      expect(headers.Accept).toBe("application/json");
      capturedBody = init?.body as FormData;
      return Response.json({ result: { image: "abc123" }, success: true });
    }) as unknown as typeof fetch;

    const result = await editOutfitPhoto(
      {
        userPhoto,
        referenceImages: [
          { bytes: new Uint8Array([4]), contentType: "image/png" },
          { bytes: new Uint8Array([5]), contentType: "image/png" },
        ],
        outfit,
        makeupEnabled: true,
        hairLength: "Medium",
        gender: "Female",
      },
      { rateLimitStore: allowStore },
    );

    expect(result).toEqual({ imageUrl: "data:image/jpeg;base64,abc123", costUsd: 0 });
    expect(capturedBody?.get("input_image_0")).toBeTruthy();
    expect(capturedBody?.get("input_image_1")).toBeTruthy();
    expect(capturedBody?.get("input_image_2")).toBeTruthy();
    expect(capturedBody?.has("input_image_3")).toBe(false);
    expect(String(capturedBody?.get("prompt"))).toContain("The Architectural Linen Silhouette");
    expect(String(capturedBody?.get("prompt"))).toContain("female-presenting");
  });

  test("caps reference images at 3 even when more are given", async () => {
    setEnv();
    let capturedBody: FormData | undefined;
    globalThis.fetch = mock(async (_url, init?: RequestInit) => {
      capturedBody = init?.body as FormData;
      return Response.json({ result: { image: "abc123" }, success: true });
    }) as unknown as typeof fetch;

    await editOutfitPhoto(
      {
        userPhoto,
        referenceImages: [
          { bytes: new Uint8Array([1]), contentType: "image/png" },
          { bytes: new Uint8Array([2]), contentType: "image/png" },
          { bytes: new Uint8Array([3]), contentType: "image/png" },
          { bytes: new Uint8Array([4]), contentType: "image/png" },
        ],
        outfit,
        makeupEnabled: false,
        hairLength: null,
        gender: null,
      },
      { rateLimitStore: allowStore },
    );

    expect(capturedBody?.has("input_image_3")).toBe(true);
    expect(capturedBody?.has("input_image_4")).toBe(false);
  });

  test("omits makeup instruction when disabled", async () => {
    setEnv();
    let capturedBody: FormData | undefined;
    globalThis.fetch = mock(async (_url, init?: RequestInit) => {
      capturedBody = init?.body as FormData;
      return Response.json({ result: { image: "abc123" }, success: true });
    }) as unknown as typeof fetch;

    await editOutfitPhoto(
      {
        userPhoto,
        referenceImages: [],
        outfit,
        makeupEnabled: false,
        hairLength: "Medium",
        gender: null,
      },
      { rateLimitStore: allowStore },
    );

    expect(String(capturedBody?.get("prompt"))).toContain("Do not add or change makeup");
  });

  test("throws ImageProviderRateLimitError when the site-wide daily quota is exhausted", async () => {
    setEnv();
    globalThis.fetch = mock(async () => {
      throw new Error("must not call Cloudflare once the daily quota is exhausted");
    }) as unknown as typeof fetch;
    await expect(
      editOutfitPhoto(
        {
          userPhoto,
          referenceImages: [],
          outfit,
          makeupEnabled: true,
          hairLength: "Medium",
          gender: null,
        },
        { rateLimitStore: denyStore },
      ),
    ).rejects.toThrow(ImageProviderRateLimitError);
  });

  test("throws ImageProviderRateLimitError on 429", async () => {
    setEnv();
    globalThis.fetch = mock(
      async () => new Response("slow down", { status: 429 }),
    ) as unknown as typeof fetch;
    await expect(
      editOutfitPhoto(
        {
          userPhoto,
          referenceImages: [],
          outfit,
          makeupEnabled: true,
          hairLength: "Medium",
          gender: null,
        },
        { rateLimitStore: allowStore },
      ),
    ).rejects.toThrow(ImageProviderRateLimitError);
  });

  test("throws when the response has no image", async () => {
    setEnv();
    globalThis.fetch = mock(async () =>
      Response.json({ success: true, result: {} }),
    ) as unknown as typeof fetch;
    await expect(
      editOutfitPhoto(
        {
          userPhoto,
          referenceImages: [],
          outfit,
          makeupEnabled: true,
          hairLength: "Medium",
          gender: null,
        },
        { rateLimitStore: allowStore },
      ),
    ).rejects.toThrow("did not return an edited image");
  });
});
