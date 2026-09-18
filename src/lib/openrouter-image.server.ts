import { requireEnv } from "@/lib/env";
import type { DailyLook } from "./generate-outfit.functions";

const TIMEOUT_MS = 75_000;
const MAX_PROMPT_LENGTH = 2048;
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
export const IMAGE_PROVIDER = "openrouter";
export const IMAGE_MODEL = "meta/muse-image";

export class ImageProviderRateLimitError extends Error {}

const SKIN_DEPTH_DESCRIPTORS: Record<string, string> = {
  Fair: "fair",
  Light: "light",
  Medium: "medium",
  Tan: "tan",
  Deep: "deep-toned",
};

function buildOutfitImagePrompt(
  outfit: DailyLook,
  gender?: string | null,
  skinDepth?: string | null,
): string {
  const outfitLine = [
    outfit.outfit.headline,
    outfit.outfit.description,
    outfit.outfit.styling_notes,
  ]
    .filter(Boolean)
    .join(" ");

  const genderLine =
    gender && gender !== "Prefer not to say" && gender !== "Non-binary"
      ? `presenting as ${gender.toLowerCase()}`
      : null;
  const skinLine = skinDepth ? `with ${SKIN_DEPTH_DESCRIPTORS[skinDepth] ?? skinDepth} skin` : null;
  const modelLine = `one adult model ${[genderLine, skinLine].filter(Boolean).join(" ")}`.trim();
  const makeupBlock = outfit.makeup ? `\n\nMakeup:\n${outfit.makeup.palette}` : "";

  return `Create a realistic full-body luxury fashion editorial photograph.

Outfit:
${outfitLine}

Hair:
${outfit.hair.style}${makeupBlock}

Presentation:
Show ${modelLine} from head to toe.
The complete outfit and shoes must be visible.
Natural realistic proportions.
Accurate fabric textures and garment colors.
Elegant neutral studio background.
Soft professional editorial lighting.
Single subject, centered composition.
No collage, no text, no captions, no logos, no watermark.`.slice(0, MAX_PROMPT_LENGTH);
}

export interface OutfitImageResult {
  imageUrl: string;
  costUsd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export async function generateOutfitImage(
  outfit: DailyLook,
  deps: { gender?: string | null; skinDepth?: string | null } = {},
): Promise<OutfitImageResult> {
  const { OPENROUTER_API_KEY } = requireEnv({
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  });

  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [
          { role: "user", content: buildOutfitImagePrompt(outfit, deps.gender, deps.skinDepth) },
        ],
        modalities: ["image", "text"],
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("Couldn't reach the OpenRouter image service.");
  }

  if (res.status === 429) throw new ImageProviderRateLimitError("OpenRouter rate limit reached.");
  if (!res.ok) throw new Error(`OpenRouter image request failed (${res.status}).`);

  const json = (await res.json()) as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
    usage?: {
      cost?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const imageUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (typeof imageUrl !== "string" || !/^data:image\/[\w.+-]+;base64,/.test(imageUrl)) {
    throw new Error("OpenRouter did not return an image.");
  }
  const usage = json.usage;
  return {
    imageUrl,
    costUsd: typeof usage?.cost === "number" ? usage.cost : null,
    promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : null,
  };
}
