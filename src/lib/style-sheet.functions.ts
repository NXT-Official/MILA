import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DailyLookSchema } from "./generate-outfit.functions";
import {
  generateStyleSheet,
  STYLE_SHEET_PROVIDER,
  STYLE_SHEET_MODEL,
} from "./openrouter-style-sheet.server";
import { ImageProviderRateLimitError } from "./openrouter-image.server";
import { aiChatCompletion, isAiConfigured } from "./ai.server";
import { logAiSpend } from "./ai-spend.server";
import { payForLookImage } from "./credits.server";
import { errorMessage } from "@/lib/utils";

const Input = z.object({
  outfit: DailyLookSchema,
});

const verifyTool = {
  function: {
    name: "report_style_sheet_check",
    parameters: {
      type: "object",
      properties: {
        passes: {
          type: "boolean",
          description:
            "true only if every panel of the 5-view sheet shows the same person as the original photo (same face, skin tone, hair) wearing the recommended outfit described.",
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

async function verifyStyleSheet(
  originalDataUri: string,
  sheetDataUri: string,
  outfitDescription: string,
  caller: { supabase: Parameters<typeof aiChatCompletion>[2]["supabase"]; userId: string },
): Promise<{ passes: boolean; reason: string }> {
  if (!isAiConfigured()) return { passes: false, reason: "Verification service not configured." };
  const result = await aiChatCompletion(
    [
      {
        role: "system",
        content:
          "You are a strict photo-editing QA reviewer for a 5-panel character reference sheet (face close-up, front, back, left profile, right profile). Compare the ORIGINAL selfie against the GENERATED sheet. Every panel must show the same person — same face, skin tone, hair, body proportions. Clothing across the panels should match the described recommended outfit. Call report_style_sheet_check with your verdict.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Recommended outfit: ${outfitDescription}` },
          { type: "text", text: "ORIGINAL selfie:" },
          { type: "image_url", image_url: { url: originalDataUri } },
          { type: "text", text: "GENERATED 5-view sheet:" },
          { type: "image_url", image_url: { url: sheetDataUri } },
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

export type StyleSheetPreviewResult =
  | { imageDataUri: string; mode: "style_sheet" }
  | { imageDataUri: null; mode: "unavailable"; reason: string };

/**
 * Renders the identity-locked 5-view style sheet for today's recommended
 * look (outfit + real shoppable picks, composed by generateLookForUser).
 * Same consent gate, credit mechanism, and retry-on-failed-QA shape as
 * generatePhotoPreview in photo-preview.functions.ts — kept as a separate
 * function rather than folded into that one because the two outputs (single
 * edited photo vs. 5-panel turnaround sheet) have different prompts, QA
 * checks, and cost profiles.
 */
export const generateStyleSheetPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<StyleSheetPreviewResult> => {
    const { data: profileRow } = await context.supabase
      .from("profiles")
      .select("gender,photo_consent_at,profile_photo_path")
      .eq("id", context.userId)
      .maybeSingle();

    if (!profileRow?.photo_consent_at || !profileRow?.profile_photo_path) {
      return { imageDataUri: null, mode: "unavailable", reason: "No consented photo on file." };
    }

    return payForLookImage(
      context.supabase,
      context.userId,
      async (): Promise<StyleSheetPreviewResult> => {
        try {
          const { data: photoBlob, error: downloadError } = await context.supabase.storage
            .from("profile-photos")
            .download(profileRow.profile_photo_path!);
          if (downloadError || !photoBlob) {
            throw new Error("Couldn't load your saved photo.");
          }
          const userPhotoBytes = bytesFromArrayBuffer(await photoBlob.arrayBuffer());
          const userPhotoContentType = photoBlob.type || "image/jpeg";
          const originalDataUri = `data:${userPhotoContentType};base64,${Buffer.from(userPhotoBytes).toString("base64")}`;

          const outfitDescription = `${data.outfit.outfit.headline}: ${data.outfit.outfit.description}`;
          const shoppablePicks = data.outfit.shoppable_picks ?? [];

          // meta/muse-image's identity preservation is inconsistent run-to-run
          // (no fixed seed) — same retry-before-giving-up approach as
          // generatePhotoPreview. Never skip verification on a retry.
          const MAX_ATTEMPTS = 3;
          let lastReason = "Your style sheet couldn't be verified safe this time.";
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const { imageUrl, costUsd } = await generateStyleSheet({
              userPhoto: { bytes: userPhotoBytes, contentType: userPhotoContentType },
              outfit: data.outfit,
              shoppablePicks,
              gender: profileRow.gender,
            });

            const verification = await verifyStyleSheet(
              originalDataUri,
              imageUrl,
              outfitDescription,
              {
                supabase: context.supabase,
                userId: context.userId,
              },
            );

            await logAiSpend(context.supabase, context.userId, {
              provider: STYLE_SHEET_PROVIDER,
              model: STYLE_SHEET_MODEL,
              costUsd,
              promptTokens: null,
              completionTokens: null,
              totalTokens: null,
            });

            if (verification.passes) {
              return { imageDataUri: imageUrl, mode: "style_sheet" };
            }
            console.warn(
              `[generateStyleSheetPreview] QA check failed (attempt ${attempt}/${MAX_ATTEMPTS}):`,
              verification.reason,
            );
            lastReason = "Your style sheet couldn't be verified safe this time.";
          }

          return { imageDataUri: null, mode: "unavailable", reason: lastReason };
        } catch (error) {
          console.error(
            "[generateStyleSheetPreview] failed:",
            errorMessage(error, "Unknown error"),
          );
          if (error instanceof ImageProviderRateLimitError) {
            return { imageDataUri: null, mode: "unavailable", reason: error.message };
          }
          return {
            imageDataUri: null,
            mode: "unavailable",
            reason: "Your style sheet couldn't be generated this time.",
          };
        }
      },
    );
  });
