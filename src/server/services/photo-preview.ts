import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aiChatCompletion, isAiConfigured } from "@/lib/ai.server";
import { logAiSpend } from "@/lib/ai-spend.server";
import { payForLookImage } from "@/lib/credits.server";
import { computeMakeupEligibility, type DailyLook } from "@/lib/generate-outfit.functions";
import { verifyFaceMatch } from "@/lib/face-match.server";
import { ImageProviderRateLimitError } from "@/lib/openrouter-image.server";
import {
  editOutfitPhoto,
  PHOTO_EDIT_PROVIDER,
  PHOTO_EDIT_MODEL,
} from "@/lib/openrouter-photo-edit.server";
import { errorMessage } from "@/lib/utils";

type MilaSupabaseClient = SupabaseClient<Database>;

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

async function verifyProtectedRegions(
  originalDataUri: string,
  editedDataUri: string,
  caller: { supabase: Parameters<typeof aiChatCompletion>[2]["supabase"]; userId: string },
): Promise<{ passes: boolean; reason: string }> {
  if (!isAiConfigured()) return { passes: false, reason: "Verification service not configured." };
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
}

function bytesFromArrayBuffer(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf);
}

const JPEG_DATA_URI_PATTERN = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;

function jpegDataUriToBytes(dataUri: string): Uint8Array {
  const match = dataUri.trim().match(JPEG_DATA_URI_PATTERN);
  if (!match) throw new Error("Expected a JPEG data URI from the photo editor.");
  return new Uint8Array(Buffer.from(match[1], "base64"));
}

export type PhotoPreviewResult =
  | { imageDataUri: string; mode: "photo_edit" }
  | { imageDataUri: null; mode: "unavailable"; reason: string };

export type PhotoPreviewInputData = { outfit: DailyLook };

/**
 * Renders the single-photo edit preview (the member's own consented selfie
 * with the recommended outfit composited on) — the optional secondary visual
 * beside the style sheet.
 *
 * Shared verbatim by the web `generatePhotoPreview` server function and the
 * mobile `POST /api/v1/look/photo-preview` route.
 */
export async function renderPhotoPreviewForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: PhotoPreviewInputData,
): Promise<PhotoPreviewResult> {
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("gender,makeup_preference,hair_length,photo_consent_at,profile_photo_path")
    .eq("id", userId)
    .maybeSingle();

  if (!profileRow?.photo_consent_at || !profileRow?.profile_photo_path) {
    return { imageDataUri: null, mode: "unavailable", reason: "No consented photo on file." };
  }

  return payForLookImage(supabase, userId, async (): Promise<PhotoPreviewResult> => {
    try {
      const { data: photoBlob, error: downloadError } = await supabase.storage
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
      // meta/muse-image's identity/gender preservation is inconsistent
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
          supabase,
          userId,
        });

        await logAiSpend(supabase, userId, {
          provider: PHOTO_EDIT_PROVIDER,
          model: PHOTO_EDIT_MODEL,
          costUsd,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        });

        if (verification.passes) {
          // A real, mathematical identity check — not another model's
          // opinion. Runs only after the structural check passes, since
          // it answers a different question ("is this the same face?"
          // vs. "is this face structurally intact?").
          const faceMatch = await verifyFaceMatch(userPhotoBytes, jpegDataUriToBytes(imageUrl));
          if (faceMatch.isMatch) {
            // Logged on every attempt (pass or fail) so drift in the
            // image-gen provider — a model update, a prompt regression —
            // shows up in distance trends before it starts failing outright.
            console.log(
              `[renderPhotoPreviewForUser] face-match check passed (attempt ${attempt}/${MAX_ATTEMPTS}):`,
              { distance: faceMatch.distance },
            );
            // Not persisted here — same as the text-to-image inspiration
            // path, this is a preview; saveOutfitToHistory uploads it
            // only if/when the user explicitly saves the look.
            return { imageDataUri: imageUrl, mode: "photo_edit" };
          }
          console.warn(
            `[renderPhotoPreviewForUser] face-match check failed (attempt ${attempt}/${MAX_ATTEMPTS}):`,
            faceMatch.reason,
            { distance: faceMatch.distance },
          );
          lastReason = "Your photo preview couldn't be verified safe this time.";
          continue;
        }
        console.warn(
          `[renderPhotoPreviewForUser] protected-region check failed (attempt ${attempt}/${MAX_ATTEMPTS}):`,
          verification.reason,
        );
        lastReason = "Your photo preview couldn't be verified safe this time.";
      }

      return { imageDataUri: null, mode: "unavailable", reason: lastReason };
    } catch (error) {
      console.error("[renderPhotoPreviewForUser] failed:", errorMessage(error, "Unknown error"));
      if (error instanceof ImageProviderRateLimitError) {
        return { imageDataUri: null, mode: "unavailable", reason: error.message };
      }
      return {
        imageDataUri: null,
        mode: "unavailable",
        reason: "Your photo preview couldn't be generated this time.",
      };
    }
  });
}
