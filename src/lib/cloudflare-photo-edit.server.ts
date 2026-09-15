import { requireEnv } from "@/lib/env";
import {
  consumeRateLimit,
  RateLimitExceededError,
  type RateLimitStore,
} from "@/lib/rate-limit.server";
import { ImageProviderRateLimitError } from "./cloudflare-image.server";
import type { DailyLook } from "./generate-outfit.functions";

// Reference-image editing via Cloudflare Workers AI. Field names
// (input_image_0..3, multipart/form-data) verified live 2026-09-15 against
// the real API: a `prompt` + `input_image_0` multipart request returned
// HTTP 200 with { result: { image: <base64 jpeg> }, success: true } — the
// exact shape this file expects. One open finding from that same live test:
// unlike flux-1-schnell, the response's `result.usage` was null and the
// call never appeared in the account's Workers AI Neurons dashboard —
// this partner model's cost/quota isn't tracked the same way, so its real
// per-call cost is unconfirmed. Real-money risk is nonetheless zero: this
// account has no payment method on file, so any billing attempt fails
// closed rather than charging anything. SITE_DAILY_LIMIT below is a
// deliberately conservative placeholder pending clearer cost data, not a
// measured budget like flux-1-schnell's.
export const PHOTO_EDIT_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const TIMEOUT_MS = 45_000;
const MAX_REFERENCE_IMAGES = 3;
const MAX_PROMPT_LENGTH = 2048;

// Separate site-wide daily budget from the flux-1-schnell inspiration image
// (cloudflare-image.server.ts) so a burst of one doesn't silently consume
// the other's free-plan allowance.
const SITE_DAILY_LIMIT = 30;
const SITE_WINDOW_SECONDS = 86_400;

function utcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildEditPrompt({
  outfit,
  makeupEnabled,
  hairLength,
  referenceCount,
}: {
  outfit: DailyLook;
  makeupEnabled: boolean;
  hairLength: string | null;
  referenceCount: number;
}): string {
  const garmentLine =
    referenceCount > 0
      ? `Change ONLY the clothing to match the ${referenceCount} reference garment image(s) provided (${outfit.outfit.headline}: ${outfit.outfit.description}).`
      : `Change ONLY the clothing to: ${outfit.outfit.headline}. ${outfit.outfit.description}`;

  const protectedLine =
    "Preserve exactly: the person's face, identity, skin tone, body proportions, pose, hands, and background. Do not beautify, slim, reshape, smooth skin, or relight the image.";

  const hairLine =
    hairLength && hairLength !== "Bald/Shaved"
      ? `Hair may be restyled to: ${outfit.hair.style} — but do not change hair length, add extensions, or change hair color.`
      : "Do not alter hair.";

  const makeupLine =
    makeupEnabled && outfit.makeup
      ? `Makeup may be added: ${outfit.makeup.palette}.`
      : "Do not add or change makeup.";

  return `${garmentLine} ${protectedLine} ${hairLine} ${makeupLine}`.slice(0, MAX_PROMPT_LENGTH);
}

export interface PhotoEditResult {
  imageUrl: string;
  costUsd: number | null;
}

/**
 * userPhoto / referenceImages are raw image bytes (already fetched by the
 * caller — this module is provider-only, it doesn't fetch storage or
 * external URLs itself). referenceImages is capped at 3 (input_image_1..3);
 * extras are ignored rather than erroring, since a partial reference set is
 * still useful.
 */
export async function editOutfitPhoto(
  {
    userPhoto,
    referenceImages,
    outfit,
    makeupEnabled,
    hairLength,
  }: {
    userPhoto: { bytes: Uint8Array; contentType: string };
    referenceImages: Array<{ bytes: Uint8Array; contentType: string }>;
    outfit: DailyLook;
    makeupEnabled: boolean;
    hairLength: string | null;
  },
  deps: { rateLimitStore?: RateLimitStore } = {},
): Promise<PhotoEditResult> {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } = requireEnv({
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
  });

  try {
    await consumeRateLimit(
      `cloudflare_flux2_daily:${utcDateKey()}`,
      { limit: SITE_DAILY_LIMIT, windowSeconds: SITE_WINDOW_SECONDS },
      deps.rateLimitStore,
    );
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      throw new ImageProviderRateLimitError(
        "Mila's daily free photo-preview quota is used up. Please try again tomorrow.",
      );
    }
    throw err;
  }

  const references = referenceImages.slice(0, MAX_REFERENCE_IMAGES);
  const form = new FormData();
  form.append(
    "prompt",
    buildEditPrompt({ outfit, makeupEnabled, hairLength, referenceCount: references.length }),
  );
  const toBlobPart = (bytes: Uint8Array) => bytes as unknown as BlobPart;
  form.append(
    "input_image_0",
    new Blob([toBlobPart(userPhoto.bytes)], { type: userPhoto.contentType }),
  );
  references.forEach((ref, i) => {
    form.append(
      `input_image_${i + 1}`,
      new Blob([toBlobPart(ref.bytes)], { type: ref.contentType }),
    );
  });

  let res: Response;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${PHOTO_EDIT_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          Accept: "application/json",
        },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    throw new Error("Couldn't reach the Cloudflare Workers AI photo-edit service.");
  }

  if (res.status === 429) {
    throw new ImageProviderRateLimitError("Cloudflare Workers AI rate limit reached.");
  }
  if (!res.ok) throw new Error(`Cloudflare photo-edit request failed (${res.status}).`);

  const json = (await res.json()) as {
    result?: { image?: string };
    success?: boolean;
    errors?: Array<{ code?: number; message?: string }>;
  };

  if (json.success === false) {
    const message = json.errors?.[0]?.message ?? "unknown error";
    throw new Error(`Cloudflare photo-edit request failed: ${message}`);
  }

  const base64Image = json.result?.image;
  if (typeof base64Image !== "string" || base64Image.length === 0) {
    throw new Error("Cloudflare did not return an edited image.");
  }

  return { imageUrl: `data:image/jpeg;base64,${base64Image}`, costUsd: 0 };
}
