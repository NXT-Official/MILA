import { requireEnv } from "@/lib/env";
import type { DailyLook } from "./generate-outfit.functions";

const DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const TIMEOUT_MS = 75_000;
const MAX_PROMPT_LENGTH = 2048;

export type CloudflareImageErrorKind =
  | "not_configured"
  | "auth"
  | "rate_limited"
  | "server_error"
  | "invalid_response"
  | "timeout"
  | "network";

export class CloudflareImageError extends Error {
  readonly kind: CloudflareImageErrorKind;
  constructor(message: string, kind: CloudflareImageErrorKind) {
    super(message);
    this.name = "CloudflareImageError";
    this.kind = kind;
  }
}

export function isCloudflareRateLimitError(err: unknown): boolean {
  return err instanceof CloudflareImageError && err.kind === "rate_limited";
}

function cloudflareEnv() {
  let accountId: string;
  let apiToken: string;
  try {
    ({ CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken } = requireEnv({
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
    }));
  } catch {
    throw new CloudflareImageError(
      "Image generation is not configured on this server.",
      "not_configured",
    );
  }
  const imageModel = process.env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  return { accountId, apiToken, imageModel };
}

export function buildOutfitImagePrompt(outfit: DailyLook): string {
  const outfitLine = [
    outfit.outfit.headline,
    outfit.outfit.description,
    outfit.outfit.styling_notes,
  ]
    .filter(Boolean)
    .join(" ");

  const prompt = `Create a realistic full-body luxury fashion editorial photograph.

Outfit:
${outfitLine}

Hair:
${outfit.hair.style}

Makeup:
${outfit.makeup.palette}

Presentation:
Show one adult fashion model from head to toe.
The complete outfit and shoes must be visible.
Natural realistic proportions.
Accurate fabric textures and garment colors.
Elegant neutral studio background.
Soft professional editorial lighting.
Single subject, centered composition.
No collage, no text, no captions, no logos, no watermark.`;

  return prompt.length > MAX_PROMPT_LENGTH ? prompt.slice(0, MAX_PROMPT_LENGTH) : prompt;
}

interface CloudflareImageSuccessResponse {
  success: true;
  result: { image?: string };
  errors?: Array<{ code?: number; message?: string }>;
}
interface CloudflareImageFailureResponse {
  success: false;
  result?: unknown;
  errors?: Array<{ code?: number; message?: string }>;
}
type CloudflareImageResponse = CloudflareImageSuccessResponse | CloudflareImageFailureResponse;

function statusToError(status: number): CloudflareImageError {
  if (status === 401 || status === 403) {
    return new CloudflareImageError("Cloudflare rejected the request credentials.", "auth");
  }
  if (status === 429) {
    return new CloudflareImageError("Cloudflare rate limit reached.", "rate_limited");
  }
  if (status >= 500) {
    return new CloudflareImageError(`Cloudflare image service error (${status}).`, "server_error");
  }
  return new CloudflareImageError(`Cloudflare image request failed (${status}).`, "server_error");
}

export async function generateOutfitImage(outfit: DailyLook): Promise<string> {
  const { accountId, apiToken, imageModel } = cloudflareEnv();
  const prompt = buildOutfitImagePrompt(outfit);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${imageModel}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt, steps: 4 }),
        signal: controller.signal,
      },
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new CloudflareImageError("Cloudflare image generation timed out.", "timeout");
    }
    throw new CloudflareImageError("Couldn't reach the Cloudflare image service.", "network");
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw statusToError(res.status);
  }

  let json: CloudflareImageResponse;
  try {
    json = (await res.json()) as CloudflareImageResponse;
  } catch {
    throw new CloudflareImageError(
      "Cloudflare returned a response that wasn't valid JSON.",
      "invalid_response",
    );
  }

  if (!json.success) {
    const detail = json.errors?.[0]?.message;
    throw new CloudflareImageError(
      detail
        ? `Cloudflare image generation failed: ${detail}`
        : "Cloudflare image generation failed.",
      "invalid_response",
    );
  }

  const image = json.result?.image;
  if (!image || typeof image !== "string" || image.length < 100) {
    throw new CloudflareImageError(
      "Cloudflare response did not include an image.",
      "invalid_response",
    );
  }

  return `data:image/jpeg;base64,${image}`;
}
