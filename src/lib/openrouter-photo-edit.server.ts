import { requireEnv } from "@/lib/env";
import {
  consumeRateLimit,
  RateLimitExceededError,
  type RateLimitStore,
} from "@/lib/rate-limit.server";
import { ImageProviderRateLimitError, IMAGE_MODEL } from "./openrouter-image.server";
import type { DailyLook } from "./generate-outfit.functions";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
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

  const content: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: toDataUri(userPhoto) } },
    ...references.map((ref) => ({ type: "image_url", image_url: { url: toDataUri(ref) } })),
  ];

  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PHOTO_EDIT_MODEL,
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("Couldn't reach the OpenRouter photo-edit service.");
  }

  if (res.status === 429) throw new ImageProviderRateLimitError("OpenRouter rate limit reached.");
  if (!res.ok) throw new Error(`OpenRouter photo-edit request failed (${res.status}).`);

  const json = (await res.json()) as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
    usage?: { cost?: number };
  };
  const imageUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (typeof imageUrl !== "string" || !/^data:image\/[\w.+-]+;base64,/.test(imageUrl)) {
    throw new Error("OpenRouter did not return an edited image.");
  }

  return {
    imageUrl,
    costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : null,
  };
}
