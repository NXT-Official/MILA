import { requireEnv } from "@/lib/env";
import {
  consumeRateLimit,
  RateLimitExceededError,
  type RateLimitStore,
} from "@/lib/rate-limit.server";
import {
  ImageProviderRateLimitError,
  IMAGE_MODEL,
  OPENROUTER_IMAGES_URL,
} from "./openrouter-image.server";
import type { DailyLook } from "./generate-outfit.functions";

const TIMEOUT_MS = 75_000;
const MAX_REFERENCE_IMAGES = 3;
const MAX_PROMPT_LENGTH = 2048;

// Image-to-image outfit-on-selfie swap — same meta/muse-image model as the
// text-to-image inspiration path (openrouter-image.server.ts), imported
// rather than redefined so the two can never drift apart.
export const PHOTO_EDIT_MODEL = IMAGE_MODEL;
export const PHOTO_EDIT_PROVIDER = "openrouter";

const SITE_DAILY_LIMIT = 30;
const SITE_WINDOW_SECONDS = 86_400;

function utcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildEditPrompt({
  outfit,
  makeupEnabled,
  hairLength,
  gender,
  referenceCount,
}: {
  outfit: DailyLook;
  makeupEnabled: boolean;
  hairLength: string | null;
  gender: string | null;
  referenceCount: number;
}): string {
  const garmentLine =
    referenceCount > 0
      ? `Change ONLY the clothing to match the ${referenceCount} reference garment image(s) provided (${outfit.outfit.headline}: ${outfit.outfit.description}).`
      : `Change ONLY the clothing to: ${outfit.outfit.headline}. ${outfit.outfit.description}`;

  const genderLine =
    gender && gender !== "Prefer not to say"
      ? ` This is a ${gender.toLowerCase()}-presenting person — the edit MUST keep them looking ${gender.toLowerCase()}-presenting; never shift apparent gender, sex characteristics, or facial structure.`
      : "";
  const protectedLine = `Preserve exactly: the person's face, identity, facial structure, eye shape and color, nose, lips, eyebrows, hairline, apparent gender presentation, skin tone and texture, freckles/moles/scars, apparent age, body proportions, pose, hands, and background.${genderLine} Do not beautify, smooth, symmetrize, lighten/darken skin, slim the face or body, reshape, or relight the image — fidelity to the source photo beats aesthetic polish.`;

  const framingLine =
    " Full-body or three-quarter framing so the full outfit is visible. Match lighting and image quality to the source photo so the result reads as one continuous photograph, not a composite.";

  const negativeLine =
    " Avoid: generic or stock-photo-looking face, any face that doesn't match the input photo, face-swap artifacts, plastic/airbrushed skin, uncanny-valley expression, warped or extra fingers/limbs, mismatched lighting between face and body, blurry or duplicated facial features, a different apparent ethnicity or skin tone than the source photo, sexualized or exposed content, hallucinated brand logos.";

  const hairGenderGuard =
    gender && gender !== "Prefer not to say"
      ? ` The restyled hair must still read as ${gender.toLowerCase()}-presenting and consistent with the stated length — never grow, lengthen, or add volume beyond what "${hairLength}" allows.`
      : "";
  const hairLine =
    hairLength && hairLength !== "Bald/Shaved"
      ? `Hair may be restyled to: ${outfit.hair.style} — but do not change hair length, add extensions, or change hair color.${hairGenderGuard}`
      : "Do not alter hair.";

  const makeupLine =
    makeupEnabled && outfit.makeup
      ? `Makeup may be added: ${outfit.makeup.palette}.`
      : "Do not add or change makeup.";

  return `${garmentLine} ${protectedLine} ${hairLine} ${makeupLine}${framingLine}${negativeLine}`.slice(
    0,
    MAX_PROMPT_LENGTH,
  );
}

export interface PhotoEditResult {
  imageUrl: string;
  costUsd: number | null;
}

function toDataUri(image: { bytes: Uint8Array; contentType: string }): string {
  return `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

/**
 * userPhoto / referenceImages are raw image bytes (already fetched by the
 * caller — this module is provider-only, it doesn't fetch storage or
 * external URLs itself). referenceImages is capped at 3; extras are
 * ignored rather than erroring, since a partial reference set is still
 * useful.
 */
export async function editOutfitPhoto(
  {
    userPhoto,
    referenceImages,
    outfit,
    makeupEnabled,
    hairLength,
    gender,
  }: {
    userPhoto: { bytes: Uint8Array; contentType: string };
    referenceImages: Array<{ bytes: Uint8Array; contentType: string }>;
    outfit: DailyLook;
    makeupEnabled: boolean;
    hairLength: string | null;
    gender: string | null;
  },
  deps: { rateLimitStore?: RateLimitStore } = {},
): Promise<PhotoEditResult> {
  const { OPENROUTER_API_KEY } = requireEnv({
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  });

  try {
    await consumeRateLimit(
      `openrouter_photo_edit_daily:${utcDateKey()}`,
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
  const prompt = buildEditPrompt({
    outfit,
    makeupEnabled,
    hairLength,
    gender,
    referenceCount: references.length,
  });

  // meta/muse-image's image-to-image path: reference images ride in
  // input_references, not inline chat message content — confirmed live
  // against the real Images API (/api/v1/images), which is a distinct
  // endpoint from chat/completions this model doesn't support at all.
  const inputReferences = [userPhoto, ...references].map((image) => ({
    type: "image_url",
    image_url: { url: toDataUri(image) },
  }));

  let res: Response;
  try {
    res = await fetch(OPENROUTER_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PHOTO_EDIT_MODEL,
        prompt,
        input_references: inputReferences,
        // face-match.server.ts's jpeg-js decoder and this file's caller
        // (photo-preview.functions.ts's JPEG_DATA_URI_PATTERN) both require
        // JPEG — the model defaults to webp otherwise (confirmed live).
        output_format: "jpeg",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("Couldn't reach the OpenRouter photo-edit service.");
  }

  if (res.status === 429) throw new ImageProviderRateLimitError("OpenRouter rate limit reached.");
  if (!res.ok) throw new Error(`OpenRouter photo-edit request failed (${res.status}).`);

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; media_type?: string }>;
    usage?: { cost?: number };
  };
  const image = json.data?.[0];
  if (!image?.b64_json || !image.media_type) {
    throw new Error("OpenRouter did not return an edited image.");
  }

  return {
    imageUrl: `data:${image.media_type};base64,${image.b64_json}`,
    costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : null,
  };
}
