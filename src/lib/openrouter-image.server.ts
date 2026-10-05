import { requireEnv } from "@/lib/env";
import { DEFAULT_AI_IMAGE_MODEL, resolveImageModel } from "./platform-settings.server";
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
// Shipped default and fallback — staff can switch the live model from the
// admin console (platform_settings, read through resolveImageModel).
export const IMAGE_MODEL = DEFAULT_AI_IMAGE_MODEL;

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
 * as a compact list — grounded in real DB titles, so the render shows what
 * the shop-the-look grid sells. Returns null when the look carries no
 * planned picks. Bare list, no heading — buildOutfitImagePrompt supplies the
 * heading so it can decide where this block sits.
 */
function buildPiecesLine(outfit: DailyLook): string | null {
  const planned = (outfit.shoppable_picks ?? []).filter((pick) => pick.source !== "similar");
  if (planned.length === 0) return null;
  return planned.map((pick) => `${pick.category}: ${pick.title}`).join("; ");
}

function buildOutfitImagePrompt(
  outfit: DailyLook,
  gender?: string | null,
  skinDepth?: string | null,
  heightCm?: number | null,
  fallbackGenderDirection?: "Male" | "Female" | null,
): string {
  const outfitLine = [
    outfit.outfit.headline,
    outfit.outfit.description,
    outfit.outfit.styling_notes,
  ]
    .filter(Boolean)
    .join(" ");

  const explicitGenderLine =
    gender && gender !== "Prefer not to say" && gender !== "Non-binary"
      ? `presenting as ${gender.toLowerCase()}`
      : null;
  // No explicit Male/Female profile: fall back to the once-per-look
  // direction the shopped picks actually used (see loadLookInventory's
  // fallbackDirection), so the rendered visual doesn't contradict the
  // items in the shop-the-look grid. Absent for a pure-Unisex look, which
  // renders neutrally same as before.
  const genderLine =
    explicitGenderLine ??
    (fallbackGenderDirection ? `presenting as ${fallbackGenderDirection.toLowerCase()}` : null);
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
  // safety/accuracy-critical and must never be truncated off. The pieces
  // block is real DB titles/categories, not model prose — it's the ground
  // truth for what the render must show, so it's protected next: never
  // truncated except in the (rare) case it alone exceeds the whole variable
  // budget. Hair is short and rarely needs cutting. The freeform Outfit
  // description is paraphrased model prose, most tolerant of being trimmed,
  // so it absorbs whatever's left of the budget and is truncated first when
  // the budget is tight.
  const PIECES_HEADING =
    "Wear exactly these real pieces (ground truth — do not substitute or invent alternate items):\n";

  const buildPrompt = (outfitText: string, piecesText: string, hairText: string): string =>
    `Create a realistic full-body luxury fashion editorial photograph.

${piecesText ? `${PIECES_HEADING}${piecesText}\n\n` : ""}Outfit:
${outfitText}

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
No collage, no text, no captions, no logos, no watermark.
No headwear of any kind — no hats, caps, beanies, visors, headscarves, or anything covering the hair; the model's styled hair must stay fully visible.`;

  const fixedLength = buildPrompt("", "", "").length;
  const variableBudget = Math.max(0, MAX_PROMPT_LENGTH - fixedLength);
  const piecesText = piecesLine ?? "";
  // The heading only renders (and only costs budget) when there's a pieces
  // block at all — the "\n\n" is the template's own separator after it.
  const piecesOverhead = piecesText ? PIECES_HEADING.length + 2 : 0;
  const piecesAvailable = Math.max(0, variableBudget - piecesOverhead);
  const piecesBudget = Math.min(piecesText.length, piecesAvailable);
  const remainingAfterPieces = Math.max(0, variableBudget - piecesOverhead - piecesBudget);
  const hairBudget = Math.min(hairAndMakeup.length, remainingAfterPieces);
  const outfitBudget = Math.max(0, remainingAfterPieces - hairBudget);

  return buildPrompt(
    outfitLine.slice(0, outfitBudget),
    piecesText.slice(0, piecesBudget),
    hairAndMakeup.slice(0, hairBudget),
  );
}

export interface OutfitImageResult {
  imageUrl: string;
  /** The model that actually rendered this image (admin-switchable). */
  model: string;
  costUsd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export async function generateOutfitImage(
  outfit: DailyLook,
  deps: {
    gender?: string | null;
    skinDepth?: string | null;
    heightCm?: number | null;
    fallbackGenderDirection?: "Male" | "Female" | null;
  } = {},
): Promise<OutfitImageResult> {
  const { OPENROUTER_API_KEY } = requireEnv({
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  });

  const model = await resolveImageModel();

  let res: Response;
  try {
    res = await fetch(OPENROUTER_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: buildOutfitImagePrompt(
          outfit,
          deps.gender,
          deps.skinDepth,
          deps.heightCm,
          deps.fallbackGenderDirection,
        ),
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
    model,
    costUsd: typeof usage?.cost === "number" ? usage.cost : null,
    promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : null,
  };
}
