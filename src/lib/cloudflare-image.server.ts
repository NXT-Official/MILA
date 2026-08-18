import { requireEnv } from "@/lib/env";
import type { DailyLook } from "./generate-outfit.functions";

const TIMEOUT_MS = 75_000;
const MAX_PROMPT_LENGTH = 2048;

export class CloudflareRateLimitError extends Error {}

function buildOutfitImagePrompt(outfit: DailyLook): string {
  const outfitLine = [
    outfit.outfit.headline,
    outfit.outfit.description,
    outfit.outfit.styling_notes,
  ]
    .filter(Boolean)
    .join(" ");

  // ponytail: constraints lead the prompt — flux has no negative-prompt field, and
  // trailing rules get cut by the MAX_PROMPT_LENGTH slice when the outfit runs long.
  // Phrased positively; "no collage" reads as "collage" to a diffusion model.
  return `A single solo adult fashion model, exactly one person, alone in the frame, centered, photographed head to toe in one continuous full-body shot. One seamless photograph, one single frame edge to edge.

Realistic luxury fashion editorial photography. Elegant neutral studio background, soft professional editorial lighting, natural realistic proportions, accurate fabric textures and garment colors, complete outfit and shoes visible.

Outfit:
${outfitLine}

Hair:
${outfit.hair.style}

Makeup:
${outfit.makeup.palette}`.slice(0, MAX_PROMPT_LENGTH);
}

export async function generateOutfitImage(outfit: DailyLook): Promise<string> {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } = requireEnv({
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
  });
  const imageModel = process.env.IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";

  let res: Response;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${imageModel}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: buildOutfitImagePrompt(outfit), steps: 4 }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    throw new Error("Couldn't reach the Cloudflare image service.");
  }

  if (res.status === 429) throw new CloudflareRateLimitError("Cloudflare rate limit reached.");
  if (!res.ok) throw new Error(`Cloudflare image request failed (${res.status}).`);

  const json = (await res.json()) as { success?: boolean; result?: { image?: string } };
  const image = json.success ? json.result?.image : undefined;
  if (typeof image !== "string" || image.length < 100) {
    throw new Error("Cloudflare did not return an image.");
  }
  return `data:image/jpeg;base64,${image}`;
}
