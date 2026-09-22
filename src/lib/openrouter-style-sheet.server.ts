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
import { buildIdentityLockLine } from "./identity-lock.server";
import type { DailyLook, ShoppablePick } from "./generate-outfit.functions";

const TIMEOUT_MS = 75_000;
const MAX_PROMPT_LENGTH = 4096;
const MAX_REFERENCE_IMAGES = 3;

// Unlike the single-photo edit path (30/day, cheaper 2K single image), the
// style sheet renders 5 panels at up to 4K resolution per attempt and can
// retry up to 3x on failed QA (renderStyleSheetForUser) — meaningfully more
// expensive per call. Capped lower for the same reason the edit path is
// capped at all: bound worst-case sitewide spend from repeated QA failures.
const SITE_DAILY_LIMIT = 20;
const SITE_WINDOW_SECONDS = 86_400;

function utcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Same model as the other two muse-image paths (text-to-image inspiration,
// single-photo outfit edit) — imported rather than redefined so all three
// can never drift apart.
export const STYLE_SHEET_MODEL = IMAGE_MODEL;
export const STYLE_SHEET_PROVIDER = "openrouter";

// OpenRouter's Images API exposes `resolution` as a discrete enum tier
// ("1K"/"2K"/"4K" observed live for image models on the platform, including
// muse-image) — there is no "16K" tier for any model on the platform. "4K"
// is the real ceiling; fall back to "2K" once if the provider rejects it.
const PRIMARY_RESOLUTION = "4K";
const FALLBACK_RESOLUTION = "2K";
const ASPECT_RATIO = "16:9";

function buildWardrobeLine(outfit: DailyLook, shoppablePicks: ShoppablePick[]): string {
  const pickLines = shoppablePicks
    .map((pick) => `${pick.title} (${pick.category}, ${pick.price} ${pick.currency})`)
    .join("; ");
  return pickLines
    ? `${outfit.outfit.headline}: ${outfit.outfit.description} Specifically wearing: ${pickLines}.`
    : `${outfit.outfit.headline}: ${outfit.outfit.description}`;
}

function buildStyleSheetPrompt({
  outfit,
  shoppablePicks,
  gender,
}: {
  outfit: DailyLook;
  shoppablePicks: ShoppablePick[];
  gender: string | null;
}): string {
  const identityLockLine = buildIdentityLockLine(gender);
  const wardrobeLine = buildWardrobeLine(outfit, shoppablePicks);

  return `REFERENCE / IDENTITY LOCK:
Use the uploaded reference image as the ONLY identity reference for the character. Recreate the EXACT SAME PERSON from the reference image with maximum identity accuracy. ${identityLockLine} Do NOT beautify, redesign, age, de-age, stylize, or alter the person's identity.

CHARACTER SHEET FORMAT:
Create a clean professional character turnaround/reference sheet containing EXACTLY FIVE clearly separated views arranged horizontally: FACE CLOSE-UP, FRONT, BACK, LEFT PROFILE, RIGHT PROFILE.

VIEW 1 — FACE CLOSE-UP: realistic head-and-shoulders close-up of the exact reference person, facing directly toward the camera, neutral natural expression, clearly showing facial identity, skin texture, hairstyle, eyes, nose, lips, jawline.
VIEW 2 — FRONT: full-body front view, standing completely straight in a neutral relaxed pose, feet naturally positioned, arms relaxed beside the body, camera at eye/chest level, full body head to feet.
VIEW 3 — BACK: full-body rear view of the exact same person, same neutral position and proportions as the front view, showing the back of the hairstyle, shoulders, torso, arms, legs, footwear.
VIEW 4 — LEFT PROFILE: full-body left-side profile, perfect 90-degree side view, no three-quarter angle, clearly showing the actual side facial profile.
VIEW 5 — RIGHT PROFILE: full-body right-side profile, perfect 90-degree side view, matching the same body proportions, posture, clothing, hairstyle.

WARDROBE / APPEARANCE (TODAY'S RECOMMENDED LOOK — wear this in every view, identically):
${wardrobeLine} Keep this exact outfit, colors, and hairstyle consistent across ALL five views.

POSE & PROPORTION LOCK:
The same person must appear in every panel. Maintain identical height, body proportions, shoulder width, torso length, arm length, leg length, head size, hairstyle, clothing, footwear, apparent age. Do not introduce any variation between views.

ENVIRONMENT:
Clean professional character-reference studio environment. Minimal light neutral background. Soft, even studio lighting. No distracting objects. No dramatic shadows.

COMPOSITION:
Five evenly spaced vertical panels with clear separation between each view. Each figure fully visible inside their assigned panel. Consistent camera distance, focal length, lighting, and scale across full-body views. Clean professional labels above each panel: FACE CLOSE UP, FRONT, BACK, LEFT PROFILE, RIGHT PROFILE. Add a subtle neutral height measurement scale beside the full-body views.

STYLE:
Photorealistic professional character reference sheet. Natural human anatomy. Realistic skin texture, hair, fabric, clothing. Accurate proportions. Clean studio photography aesthetic. High detail. No cartoon styling, no illustration, no CGI appearance, no exaggerated anatomy.

CONTINUITY LOCK:
All five panels represent ONE SINGLE PERSON. Identity, face, hairstyle, body, clothing, proportions, age, and physical characteristics must remain perfectly consistent across every view.

NEGATIVE CONSTRAINTS:
No identity drift. No different person. No face alteration. No hairstyle changes. No clothing changes outside the recommended look above. No body-shape changes. No age changes. No extra people. No duplicate limbs. No distorted hands. No incorrect anatomy. No three-quarter views. No cropped full-body views. No dramatic poses. No perspective inconsistencies. No background clutter. No text except the five required view labels and subtle measurement markings.

OUTPUT:
One complete professional 5-view character turnaround sheet showing today's recommended outfit.`.slice(
    0,
    MAX_PROMPT_LENGTH,
  );
}

export interface StyleSheetResult {
  imageUrl: string;
  costUsd: number | null;
}

function toDataUri(image: { bytes: Uint8Array; contentType: string }): string {
  return `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

async function requestStyleSheet(
  apiKey: string,
  prompt: string,
  inputReferences: Array<{ type: string; image_url: { url: string } }>,
  resolution: string,
): Promise<Response> {
  return fetch(OPENROUTER_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: STYLE_SHEET_MODEL,
      prompt,
      input_references: inputReferences,
      resolution,
      aspect_ratio: ASPECT_RATIO,
      output_format: "jpeg",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * userPhoto is the consented selfie's raw bytes (fetched by the caller —
 * this module is provider-only). shoppablePicks are the real, DB-hydrated
 * products deepseek just recommended (look.ts) — their titles/categories are
 * what "today's recommended look" describes in the prompt; their images are
 * NOT sent as visual references (a second person/garment-only photo isn't a
 * reliable style transfer input for this model and risks identity
 * contamination, same reasoning as photo-preview.functions.ts's decision to
 * skip product reference images for the single-photo edit).
 */
export async function generateStyleSheet(
  {
    userPhoto,
    outfit,
    shoppablePicks,
    gender,
  }: {
    userPhoto: { bytes: Uint8Array; contentType: string };
    outfit: DailyLook;
    shoppablePicks: ShoppablePick[];
    gender: string | null;
  },
  deps: { rateLimitStore?: RateLimitStore } = {},
): Promise<StyleSheetResult> {
  const { OPENROUTER_API_KEY } = requireEnv({
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  });

  try {
    await consumeRateLimit(
      `openrouter_style_sheet_daily:${utcDateKey()}`,
      { limit: SITE_DAILY_LIMIT, windowSeconds: SITE_WINDOW_SECONDS },
      deps.rateLimitStore,
    );
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      throw new ImageProviderRateLimitError(
        "Mila's daily free style-sheet quota is used up. Please try again tomorrow.",
      );
    }
    throw err;
  }

  const prompt = buildStyleSheetPrompt({ outfit, shoppablePicks, gender });
  const inputReferences = [{ type: "image_url", image_url: { url: toDataUri(userPhoto) } }].slice(
    0,
    MAX_REFERENCE_IMAGES,
  );

  let res: Response;
  try {
    res = await requestStyleSheet(OPENROUTER_API_KEY, prompt, inputReferences, PRIMARY_RESOLUTION);
    if (!res.ok && res.status !== 429) {
      const body = await res.text();
      if (/resolution|size/i.test(body)) {
        res = await requestStyleSheet(
          OPENROUTER_API_KEY,
          prompt,
          inputReferences,
          FALLBACK_RESOLUTION,
        );
      } else {
        throw new Error(`OpenRouter style-sheet request failed (${res.status}): ${body}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("OpenRouter style-sheet request failed")) {
      throw err;
    }
    throw new Error("Couldn't reach the OpenRouter style-sheet service.");
  }

  if (res.status === 429) throw new ImageProviderRateLimitError("OpenRouter rate limit reached.");
  if (!res.ok) throw new Error(`OpenRouter style-sheet request failed (${res.status}).`);

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; media_type?: string }>;
    usage?: { cost?: number };
  };
  const image = json.data?.[0];
  if (!image?.b64_json || !image.media_type) {
    throw new Error("OpenRouter did not return a style-sheet image.");
  }

  return {
    imageUrl: `data:${image.media_type};base64,${image.b64_json}`,
    costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : null,
  };
}
