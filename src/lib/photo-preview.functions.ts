import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DailyLookSchema, computeMakeupEligibility } from "./generate-outfit.functions";
import { editOutfitPhoto } from "./cloudflare-photo-edit.server";
import { ImageProviderRateLimitError } from "./cloudflare-image.server";
import { aiChatCompletion, isAiConfigured } from "./ai.server";
import { logAiSpend } from "./ai-spend.server";
import { safeExternalFetch } from "./safe-external-fetch.server";
import { payForLookImage } from "./credits.server";
import { errorMessage } from "@/lib/utils";

const Input = z.object({
  outfit: DailyLookSchema,
  productIds: z.array(z.string().uuid()).max(3),
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

    const { data: productRows } = await context.supabase
      .from("products")
      .select("image_url")
      .in("id", data.productIds)
      .not("image_url", "is", null);

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

          const referenceImages: Array<{ bytes: Uint8Array; contentType: string }> = [];
          for (const row of productRows ?? []) {
            if (!row.image_url) continue;
            try {
              const res = await safeExternalFetch(row.image_url);
              if (!res.ok) continue;
              referenceImages.push({
                bytes: bytesFromArrayBuffer(await res.arrayBuffer()),
                contentType: res.headers.get("content-type") || "image/jpeg",
              });
            } catch (err) {
              console.warn("[generatePhotoPreview] reference image fetch failed:", err);
            }
          }

          const makeupEnabled = computeMakeupEligibility({
            gender: profileRow.gender,
            makeup_preference: profileRow.makeup_preference,
          });

          const { imageUrl, costUsd } = await editOutfitPhoto({
            userPhoto: { bytes: userPhotoBytes, contentType: userPhotoContentType },
            referenceImages,
            outfit: data.outfit,
            makeupEnabled,
            hairLength: profileRow.hair_length,
          });

          const originalDataUri = `data:${userPhotoContentType};base64,${Buffer.from(userPhotoBytes).toString("base64")}`;
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

          if (!verification.passes) {
            console.warn(
              "[generatePhotoPreview] protected-region check failed:",
              verification.reason,
            );
            return {
              imageDataUri: null,
              mode: "unavailable",
              reason: "Your photo preview couldn't be verified safe this time.",
            };
          }

          // Not persisted here — same as the text-to-image inspiration path,
          // this is a preview; saveOutfitToHistory uploads it only if/when the
          // user explicitly saves the look.
          return { imageDataUri: imageUrl, mode: "photo_edit" };
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
