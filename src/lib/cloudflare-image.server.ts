import { requireEnv } from "@/lib/env";
import {
  consumeRateLimit,
  RateLimitExceededError,
  type RateLimitStore,
} from "@/lib/rate-limit.server";
import type { DailyLook } from "./generate-outfit.functions";

// TEMPORARY provider — see openrouter-image.server.ts for the paid provider it
// replaces. To swap back: change the two import lines in
// generate-outfit.functions.ts from "./cloudflare-image.server" to
// "./openrouter-image.server" and delete this file (+ its test).
const TIMEOUT_MS = 30_000;
const MAX_PROMPT_LENGTH = 2048;
const GENERATION_STEPS = 4;
export const IMAGE_PROVIDER = "cloudflare";
export const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

// Cloudflare Workers AI Free plan: 10,000 Neurons/day shared across the whole
// account. Measured live against the real API (2026-09-15): flux-1-schnell
// at 4 steps costs 172.8 Neurons/image (from the response's usage.neurons
// field) — not the ~43 originally estimated from list pricing. 10,000/172.8
// ≈ 57.8, so 50/day leaves real headroom rather than sitting at the edge.
// This account also has no payment method on file, so even a miscount here
// fails closed (blocked request) rather than ever billing anything.
const SITE_DAILY_LIMIT = 50;
const SITE_WINDOW_SECONDS = 86_400;

export class ImageProviderRateLimitError extends Error {}

function buildOutfitImagePrompt(outfit: DailyLook, gender?: string | null): string {
  const outfitLine = [
    outfit.outfit.headline,
    outfit.outfit.description,
    outfit.outfit.styling_notes,
  ]
    .filter(Boolean)
    .join(" ");

  const modelLine =
    gender && gender !== "Prefer not to say" && gender !== "Non-binary"
      ? `one adult model presenting as ${gender.toLowerCase()}`
      : "one adult model";
  const makeupLine = outfit.makeup ? ` Makeup: ${outfit.makeup.palette}.` : "";

  return `Editorial full-body luxury fashion photograph of ${modelLine} wearing: ${outfitLine}
Hair: ${outfit.hair.style}.${makeupLine}
Head to toe in frame, complete outfit and shoes visible, natural proportions, accurate fabric textures and garment colors, elegant neutral studio background, soft professional lighting, single centered subject, no text, no logos, no watermark.`.slice(
    0,
    MAX_PROMPT_LENGTH,
  );
}

export interface OutfitImageResult {
  imageUrl: string;
  costUsd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

function utcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function generateOutfitImage(
  outfit: DailyLook,
  deps: { rateLimitStore?: RateLimitStore; gender?: string | null } = {},
): Promise<OutfitImageResult> {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } = requireEnv({
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
  });

  try {
    await consumeRateLimit(
      `cloudflare_flux_daily:${utcDateKey()}`,
      { limit: SITE_DAILY_LIMIT, windowSeconds: SITE_WINDOW_SECONDS },
      deps.rateLimitStore,
    );
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      throw new ImageProviderRateLimitError(
        "Mila's daily free visual quota is used up. Please try again tomorrow.",
      );
    }
    throw err;
  }

  let res: Response;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${IMAGE_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          prompt: buildOutfitImagePrompt(outfit, deps.gender),
          steps: GENERATION_STEPS,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    throw new Error("Couldn't reach the Cloudflare Workers AI image service.");
  }

  if (res.status === 429) {
    throw new ImageProviderRateLimitError("Cloudflare Workers AI rate limit reached.");
  }
  if (!res.ok) throw new Error(`Cloudflare image request failed (${res.status}).`);

  const json = (await res.json()) as {
    result?: { image?: string };
    success?: boolean;
    errors?: Array<{ code?: number; message?: string }>;
  };

  if (json.success === false) {
    const message = json.errors?.[0]?.message ?? "unknown error";
    throw new Error(`Cloudflare image request failed: ${message}`);
  }

  const base64Image = json.result?.image;
  if (typeof base64Image !== "string" || base64Image.length === 0) {
    throw new Error("Cloudflare did not return an image.");
  }

  return {
    imageUrl: `data:image/jpeg;base64,${base64Image}`,
    // Free plan (10,000 Neurons/day, hard-blocked past that — see
    // SITE_DAILY_LIMIT above): this call costs $0 as long as the account
    // stays on Workers Free and under the daily allowance.
    costUsd: 0,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  };
}
