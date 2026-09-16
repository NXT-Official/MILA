import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DailyLookSchema, computeMakeupEligibility } from "./generate-outfit.functions";
import { editOutfitPhoto } from "./cloudflare-photo-edit.server";
import { ImageProviderRateLimitError } from "./cloudflare-image.server";
import { aiChatCompletion, isAiConfigured } from "./ai.server";
import { CloudflareMultiImageUnsupportedError } from "./cloudflare-chat.server";
import { logAiSpend } from "./ai-spend.server";
import { payForLookImage } from "./credits.server";
import { errorMessage } from "@/lib/utils";

const Input = z.object({
  outfit: DailyLookSchema,
});

const verifyTool = {
  function: {
    name: "report_protected_region_check",
    parameters: {
      type: "object",
      properties: {
        passes: {
          type: "boolean",
          description:
            "true only if the edited photo keeps the same person, identity, pose, background, and hands as the original, and only clothing (plus hair/makeup if explicitly instructed) differs.",
        },
        reason: {
          type: "string",
          description: "One short sentence — especially important when passes is false.",
        },
      },
      required: ["passes", "reason"],
      additionalProperties: false,
    },
  },
};

// Single-image fallback for providers that can't take two images in one
// call (Cloudflare Workers AI's vision endpoint takes exactly one — see
// CloudflareMultiImageUnsupportedError).
//
// This intentionally does NOT judge gender or hair length. Two earlier
// versions of this file tried that and got it wrong in both directions —
// first trusting a false-negative verdict as correct, then disabling the
// gate entirely on a wrong diagnosis. Proven directly, not inferred: fed
// this exact model the user's own unedited, un-retouched original selfie
// (a verified male, glasses, short hair) with no edit involved at all, and
// it independently said "female with long hair" on 2 of 2 calls before
// hitting the account's daily quota — the same hallucination it produces
// on edited output. Since it can't correctly read this trait even with
// zero editing in the loop, no phrasing of this instruction can fix it;
// gating results on it rejects good edits at random. It still checks the
// one thing it doesn't need identity judgment for: whether the image is
// structurally broken.
const singleImageVerifyTool = {
  function: {
    name: "report_edit_sanity_check",
    parameters: {
      type: "object",
      properties: {
        passes: {
          type: "boolean",
          description:
            "true only if this shows one intact, undistorted human face and normal hands/body with no visible editing artifacts (no melted features, no extra/missing limbs, no garbled regions).",
        },
        reason: {
          type: "string",
          description: "One short sentence, especially if passes is false.",
        },
      },
      required: ["passes", "reason"],
      additionalProperties: false,
    },
  },
};

async function verifyProtectedRegions(
  originalDataUri: string,
  editedDataUri: string,
  caller: { supabase: Parameters<typeof aiChatCompletion>[2]["supabase"]; userId: string },
): Promise<{ passes: boolean; reason: string }> {
  if (!isAiConfigured()) return { passes: false, reason: "Verification service not configured." };
  try {
    const result = await aiChatCompletion(
      [
        {
          role: "system",
          content:
            "You are a strict photo-editing QA reviewer. Compare the ORIGINAL and EDITED photos. The edit is only allowed to change clothing (and hair/makeup if explicitly mentioned). Face, identity, skin tone, body proportions, pose, hands, and background must be unchanged. Call report_protected_region_check with your verdict.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "ORIGINAL photo:" },
            { type: "image_url", image_url: { url: originalDataUri } },
            { type: "text", text: "EDITED photo:" },
            { type: "image_url", image_url: { url: editedDataUri } },
          ],
        },
      ],
      verifyTool,
      caller,
    );
    if (!result.ok) return { passes: false, reason: "Verification check failed to run." };
    const parsed = result.args as { passes?: unknown; reason?: unknown };
    return {
      passes: parsed.passes === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "No reason given.",
    };
  } catch (err) {
    if (!(err instanceof CloudflareMultiImageUnsupportedError)) throw err;
  }

  const result = await aiChatCompletion(
    [
      {
        role: "system",
        content:
          "You are a strict photo-editing QA reviewer checking a single edited photo for obvious structural problems, since you cannot see the original for comparison. Call report_edit_sanity_check with your verdict.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Check this edited photo. Flag it only if the face looks distorted, melted, or wrong, if hands look abnormal (wrong number of fingers, merged), or if there are obvious garbled/broken regions. Do not judge gender, hair length, or styling — only structural integrity.",
          },
          { type: "image_url", image_url: { url: editedDataUri } },
        ],
      },
    ],
    singleImageVerifyTool,
    caller,
  );
  if (!result.ok) return { passes: false, reason: "Verification check failed to run." };
  const parsed = result.args as { passes?: unknown; reason?: unknown };
  return {
    passes: parsed.passes === true,
    reason: typeof parsed.reason === "string" ? parsed.reason : "No reason given.",
  };
}

function bytesFromArrayBuffer(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf);
}

export type PhotoPreviewResult =
  | { imageDataUri: string; mode: "photo_edit" }
  | { imageDataUri: null; mode: "unavailable"; reason: string };

export const generatePhotoPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<PhotoPreviewResult> => {
    const { data: profileRow } = await context.supabase
      .from("profiles")
      .select("gender,makeup_preference,hair_length,photo_consent_at,profile_photo_path")
      .eq("id", context.userId)
      .maybeSingle();

    if (!profileRow?.photo_consent_at || !profileRow?.profile_photo_path) {
      return { imageDataUri: null, mode: "unavailable", reason: "No consented photo on file." };
    }

    return payForLookImage(
      context.supabase,
      context.userId,
      async (): Promise<PhotoPreviewResult> => {
        try {
          const { data: photoBlob, error: downloadError } = await context.supabase.storage
            .from("profile-photos")
            .download(profileRow.profile_photo_path!);
          if (downloadError || !photoBlob) {
            throw new Error("Couldn't load your saved photo.");
          }
          const userPhotoBytes = bytesFromArrayBuffer(await photoBlob.arrayBuffer());
          const userPhotoContentType = photoBlob.type || "image/jpeg";

          const makeupEnabled = computeMakeupEligibility({
            gender: profileRow.gender,
            makeup_preference: profileRow.makeup_preference,
          });

          const originalDataUri = `data:${userPhotoContentType};base64,${Buffer.from(userPhotoBytes).toString("base64")}`;

          // No product reference images: verified live that this catalog is
          // entirely modeled fashion photography (real people, mostly
          // women's fashion — matchLookProducts isn't gender-aware), and a
          // second person's face/body in the reference images is a real
          // identity-contamination risk for an edit that's supposed to
          // preserve exactly one person. The garment's text description
          // (outfit.outfit.description) already carries the styling detail
          // this model needs — verified live that text-only edits render
          // correctly without needing a photo reference.
          //
          // flux-2-klein-4b's identity/gender preservation is inconsistent
          // run-to-run even without references (diffusion models have no
          // fixed seed here) — a failed verification is often the model,
          // not a structurally bad request, so retry before giving up.
          // Never skip verification just because a retry was needed — a
          // bad result should still fall back.
          const MAX_ATTEMPTS = 3;
          let lastReason = "Your photo preview couldn't be verified safe this time.";
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const { imageUrl, costUsd } = await editOutfitPhoto({
              userPhoto: { bytes: userPhotoBytes, contentType: userPhotoContentType },
              referenceImages: [],
              outfit: data.outfit,
              makeupEnabled,
              hairLength: profileRow.hair_length,
              gender: profileRow.gender,
            });

            const verification = await verifyProtectedRegions(originalDataUri, imageUrl, {
              supabase: context.supabase,
              userId: context.userId,
            });

            await logAiSpend(context.supabase, context.userId, {
              provider: "cloudflare",
              model: "@cf/black-forest-labs/flux-2-klein-4b",
              costUsd,
              promptTokens: null,
              completionTokens: null,
              totalTokens: null,
            });

            if (verification.passes) {
              // Not persisted here — same as the text-to-image inspiration
              // path, this is a preview; saveOutfitToHistory uploads it
              // only if/when the user explicitly saves the look.
              return { imageDataUri: imageUrl, mode: "photo_edit" };
            }
            console.warn(
              `[generatePhotoPreview] protected-region check failed (attempt ${attempt}/${MAX_ATTEMPTS}):`,
              verification.reason,
            );
            lastReason = "Your photo preview couldn't be verified safe this time.";
          }

          return { imageDataUri: null, mode: "unavailable", reason: lastReason };
        } catch (error) {
          console.error("[generatePhotoPreview] failed:", errorMessage(error, "Unknown error"));
          if (error instanceof ImageProviderRateLimitError) {
            return { imageDataUri: null, mode: "unavailable", reason: error.message };
          }
          return {
            imageDataUri: null,
            mode: "unavailable",
            reason: "Your photo preview couldn't be generated this time.",
          };
        }
      },
    );
  });
