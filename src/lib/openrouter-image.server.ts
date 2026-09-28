import { requireEnv } from "@/lib/env";
import type { DailyLook } from "./generate-outfit.functions";

const TIMEOUT_MS = 75_000;
const MAX_PROMPT_LENGTH = 2048;
// meta/muse-image is an image-generation model — it only exists behind
// OpenRouter's dedicated Images API (/api/v1/images), not the general
// chat/completions endpoint. Confirmed live: chat/completions returns 404
// "cannot be used with the chat/completions endpoint. Use the
// /api/v1/images endpoint instead."
export const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
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

function formatHeightLine(heightCm?: number | null): string | null {
  if (heightCm == null) return null;
  const totalInches = heightCm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return `exactly ${heightCm}cm tall (${feet}'${inches}") — render the model's real-world height and proportions to this exact figure, not an idealized/elongated fashion-model height`;
}

/**
 * The outfit's actual shoppable pieces (never the "similar" shelf options)
 * as a compact line — grounded in real DB titles, so the render shows what
 * the shop-the-look grid sells. Returns null when the look carries no
 * planned picks.
 */
function buildPiecesLine(outfit: DailyLook): string | null {
  const planned = (outfit.shoppable_picks ?? []).filter((pick) => pick.source !== "similar");
  if (planned.length === 0) return null;
  return `Key pieces: ${planned.map((pick) => `${pick.category}: ${pick.title}`).join("; ")}.`;
}

function buildOutfitImagePrompt(
  outfit: DailyLook,
  gender?: string | null,
  skinDepth?: string | null,
  heightCm?: number | null,
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
  const heightLine = formatHeightLine(heightCm);
  const modelLine =
    `one adult model ${[genderLine, skinLine].filter(Boolean).join(" ")}`.trim() +
    (heightLine ? `, ${heightLine}` : "");
  const makeupBlock = outfit.makeup ? `\n\nMakeup:\n${outfit.makeup.palette}` : "";
  const hairAndMakeup = `${outfit.hair.style}${makeupBlock}`;
  const piecesLine = buildPiecesLine(outfit);

  // The "Presentation" block (including height/gender/skin, which are
  // server-derived, not model text) and the trailing anti-artifact line are
  // safety/accuracy-critical and must never be truncated off. Only the
  // model-generated Outfit/Hair/Makeup text and the DB-derived Key pieces
  // line are variable-length, so truncate those to fit the remaining budget
  // instead of slicing the whole prompt (outfit takes priority over the
  // pieces list, which takes priority over hair).
  const buildPrompt = (outfitText: string, piecesText: string, hairText: string): string =>
    `Create a realistic full-body luxury fashion editorial photograph.

Outfit:
${outfitText}${piecesText ? `\n${piecesText}` : ""}

Hair:
${hairText}

Presentation:
Show ${modelLine} from head to toe.
The complete outfit and shoes must be visible.
Natural realistic proportions.
Accurate fabric textures and garment colors.
Elegant neutral studio background.
Soft professional editorial lighting.
Single subject, centered composition.
No collage, no text, no captions, no logos, no watermark.`;

  const fixedLength = buildPrompt("", "", "").length;
  const variableBudget = Math.max(0, MAX_PROMPT_LENGTH - fixedLength);
  const piecesText = piecesLine ?? "";
  const outfitBudget = Math.min(outfitLine.length, Math.ceil(variableBudget * 0.55));
  const piecesBudget = Math.min(piecesText.length, Math.ceil(variableBudget * 0.25));
  const hairBudget = Math.max(0, variableBudget - outfitBudget - piecesBudget);

  return buildPrompt(
    outfitLine.slice(0, outfitBudget),
    piecesText.slice(0, piecesBudget),
    hairAndMakeup.slice(0, hairBudget),
  );
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
  deps: { gender?: string | null; skinDepth?: string | null; heightCm?: number | null } = {},
): Promise<OutfitImageResult> {
  const { OPENROUTER_API_KEY } = requireEnv({
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  });

  let res: Response;
  try {
    res = await fetch(OPENROUTER_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: buildOutfitImagePrompt(outfit, deps.gender, deps.skinDepth, deps.heightCm),
        output_format: "jpeg",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("Couldn't reach the OpenRouter image service.");
  }

  if (res.status === 429) throw new ImageProviderRateLimitError("OpenRouter rate limit reached.");
  if (!res.ok) throw new Error(`OpenRouter image request failed (${res.status}).`);

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; media_type?: string }>;
    usage?: {
      cost?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const image = json.data?.[0];
  if (!image?.b64_json || !image.media_type) {
    throw new Error("OpenRouter did not return an image.");
  }
  const usage = json.usage;
  return {
    imageUrl: `data:${image.media_type};base64,${image.b64_json}`,
    costUsd: typeof usage?.cost === "number" ? usage.cost : null,
    promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : null,
  };
}
