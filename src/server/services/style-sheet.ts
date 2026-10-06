import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aiChatCompletion, isAiConfigured } from "@/lib/ai.server";
import { logAiSpend } from "@/lib/ai-spend.server";
import { isPaidStyleMember, payForLookImage } from "@/lib/credits.server";
import type { DailyLook } from "@/lib/generate-outfit.functions";
import { generateStyleSheet, STYLE_SHEET_PROVIDER } from "@/lib/openrouter-style-sheet.server";
import { ImageProviderRateLimitError } from "@/lib/openrouter-image.server";
import { errorMessage } from "@/lib/utils";
import { createRenderBudget } from "./render-budget";

type MilaSupabaseClient = SupabaseClient<Database>;

/** Per-call ceilings for the 5-panel render and the two-image QA call.
 * Measured live 2026-10-06: renders 17–38s, QA 12–27s — a whole attempt is
 * typically 30–65s, so three fit the budget when nothing stalls. */
const STYLE_SHEET_RENDER_MS = 150_000;
const STYLE_SHEET_VERIFY_MS = 110_000;
/** Kept back from the render so its QA call always gets a real chance. */
const STYLE_SHEET_VERIFY_RESERVE_MS = 40_000;
/** Don't start an attempt that can't plausibly render AND verify in time. */
const STYLE_SHEET_MIN_ATTEMPT_MS = 90_000;

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

/**
 * The QA reviewer's instructions — exported so a test can pin the
 * headwear-tolerance clause. The renderer deliberately never wears hats or
 * other face-covering pieces (see isFaceObscuringAccessory in
 * openrouter-style-sheet.server.ts), so the reviewer must not fail a sheet
 * for a hat from the outfit note being absent; before this clause, a
 * rain-hat look failed every attempt ("adds a cap ... obscures the original
 * hair"). Identity, hair, and named-garment checks stay strict.
 */
export const STYLE_SHEET_QA_PROMPT =
  "You are a strict photo-editing QA reviewer for a 5-panel character reference sheet (face close-up, front, back, left profile, right profile). Compare the ORIGINAL selfie against the GENERATED sheet. Every panel must show the same person — same face, skin tone, hair, body proportions. Clothing across the panels should match the described recommended outfit. The sheet deliberately shows NO headwear (hats, caps, beanies, visors) and no face-covering accessories, so the hair and face stay fully visible — never fail a sheet because a hat mentioned in the outfit is absent, or because the head is bare. Accessories the look adds beyond the original selfie (bags, jewelry, belts) are expected — judge them only for identity impact. Fail when the face, identity, or visible hair differs from the original, or when a garment named in the outfit is missing. Call report_style_sheet_check with your verdict.";

async function verifyStyleSheet(
  originalDataUri: string,
  sheetDataUri: string,
  outfitDescription: string,
  caller: { supabase: Parameters<typeof aiChatCompletion>[2]["supabase"]; userId: string },
  timeoutMs?: number,
): Promise<StyleSheetCheck> {
  if (!isAiConfigured()) {
    return { passes: false, ran: false, reason: "Verification service not configured." };
  }
  const result = await aiChatCompletion(
    [
      {
        role: "system",
        content: STYLE_SHEET_QA_PROMPT,
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
    { timeoutMs },
  );
  if (!result.ok) return { passes: false, ran: false, reason: "Verification check failed to run." };
  const parsed = result.args as { passes?: unknown; reason?: unknown };
  return {
    passes: parsed.passes === true,
    ran: true,
    reason: typeof parsed.reason === "string" ? parsed.reason : "No reason given.",
  };
}

/** `ran: false` = the QA call itself failed (timeout, provider error) — the
 * sheet was never judged, so re-checking the same paid render beats
 * discarding it. `ran: true, passes: false` = a real rejection. */
type StyleSheetCheck = { passes: boolean; ran: boolean; reason: string };

function bytesFromArrayBuffer(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf);
}

export type StyleSheetPreviewResult =
  | { imageDataUri: string; mode: "style_sheet" }
  | { imageDataUri: null; mode: "unavailable"; reason: string };

export type StyleSheetInputData = { outfit: DailyLook };

/**
 * Renders the identity-locked 5-view style sheet for today's recommended
 * look (outfit + real shoppable picks, composed by generateLookForUser).
 * Same consent gate, credit mechanism, and retry-on-failed-QA shape as
 * renderPhotoPreview in photo-preview.ts — kept as a separate function rather
 * than folded into that one because the two outputs (single edited photo vs.
 * 5-panel turnaround sheet) have different prompts, QA checks, and cost
 * profiles.
 *
 * Shared verbatim by the web `generateStyleSheetPreview` server function and
 * the mobile `POST /api/v1/look/style-sheet` route.
 */
export async function renderStyleSheetForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: StyleSheetInputData,
): Promise<StyleSheetPreviewResult> {
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("gender,photo_consent_at,profile_photo_path")
    .eq("id", userId)
    .maybeSingle();

  if (!profileRow?.photo_consent_at || !profileRow?.profile_photo_path) {
    return { imageDataUri: null, mode: "unavailable", reason: "No consented photo on file." };
  }

  // Decided before payForLookImage spends a credit, so a member's last
  // purchased credit still counts them as paid.
  const paidMember = await isPaidStyleMember(supabase, userId);
  const budget = createRenderBudget();

  return payForLookImage(supabase, userId, async (): Promise<StyleSheetPreviewResult> => {
    try {
      const { data: photoBlob, error: downloadError } = await supabase.storage
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
      // renderPhotoPreview. Never skip verification on a retry. Each attempt
      // runs on the time actually left (createRenderBudget): a thrown error
      // or failed QA moves on to the next attempt only when a whole render +
      // check can still finish before Vercel's 300s kill.
      const MAX_ATTEMPTS = 3;
      let lastReason = "Your style sheet couldn't be verified safe this time.";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (!budget.canStart(STYLE_SHEET_MIN_ATTEMPT_MS)) {
          console.warn(
            `[renderStyleSheetForUser] stopping before attempt ${attempt}/${MAX_ATTEMPTS} — ${Math.round(budget.remainingMs() / 1000)}s left in the function budget`,
          );
          break;
        }
        try {
          const {
            imageUrl,
            model: imageModel,
            costUsd,
          } = await generateStyleSheet(
            {
              userPhoto: { bytes: userPhotoBytes, contentType: userPhotoContentType },
              outfit: data.outfit,
              shoppablePicks,
              gender: profileRow.gender,
            },
            {
              enforceSiteQuota: !paidMember,
              timeoutMs: budget.clamp(STYLE_SHEET_RENDER_MS, STYLE_SHEET_VERIFY_RESERVE_MS),
            },
          );

          await logAiSpend(supabase, userId, {
            provider: STYLE_SHEET_PROVIDER,
            // Whatever model the console has active right now — not a constant.
            model: imageModel,
            costUsd,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
          });

          const check = () =>
            verifyStyleSheet(
              originalDataUri,
              imageUrl,
              outfitDescription,
              { supabase, userId },
              budget.clamp(STYLE_SHEET_VERIFY_MS),
            );
          let verification = await check();
          if (!verification.ran && budget.canStart(STYLE_SHEET_VERIFY_RESERVE_MS)) {
            console.warn(
              `[renderStyleSheetForUser] QA call failed to run (attempt ${attempt}/${MAX_ATTEMPTS}) — re-checking the same sheet`,
            );
            verification = await check();
          }

          if (verification.passes) {
            return { imageDataUri: imageUrl, mode: "style_sheet" };
          }
          console.warn(
            `[renderStyleSheetForUser] QA check failed (attempt ${attempt}/${MAX_ATTEMPTS}):`,
            verification.reason,
          );
          lastReason = "Your style sheet couldn't be verified safe this time.";
        } catch (attemptError) {
          if (attemptError instanceof ImageProviderRateLimitError) throw attemptError;
          console.warn(
            `[renderStyleSheetForUser] attempt ${attempt}/${MAX_ATTEMPTS} threw:`,
            errorMessage(attemptError, "Unknown error"),
          );
          lastReason = "Your style sheet couldn't be generated this time.";
        }
      }

      return { imageDataUri: null, mode: "unavailable", reason: lastReason };
    } catch (error) {
      console.error("[renderStyleSheetForUser] failed:", errorMessage(error, "Unknown error"));
      if (error instanceof ImageProviderRateLimitError) {
        return { imageDataUri: null, mode: "unavailable", reason: error.message };
      }
      return {
        imageDataUri: null,
        mode: "unavailable",
        reason: "Your style sheet couldn't be generated this time.",
      };
    }
  });
}
