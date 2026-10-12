import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { aiChatCompletion, isAiConfigured } from "@/lib/ai.server";
import { logAiSpend } from "@/lib/ai-spend.server";
import { isPaidStyleMember, payForLookImage } from "@/lib/credits.server";
import {
  GENERATION_DEADLINE_SECONDS,
  lookImageFreeSlot,
  resolveDailyAllowance,
  withGenerationJob,
  withJobId,
  type GenerationJobRunning,
  type GenerationSettlement,
} from "@/lib/generation-jobs.server";
import { computeMakeupEligibility, type DailyLook } from "@/lib/generate-outfit.functions";
import { verifyFaceMatch } from "@/lib/face-match.server";
import { ImageProviderRateLimitError } from "@/lib/openrouter-image.server";
import { editOutfitPhoto, PHOTO_EDIT_PROVIDER } from "@/lib/openrouter-photo-edit.server";
import { errorMessage } from "@/lib/utils";
import { createRenderBudget } from "./render-budget";

type MilaSupabaseClient = SupabaseClient<Database>;

/** Per-call ceilings: the single-photo edit (openrouter-photo-edit's 75s) and
 * the two-image QA call. */
const PHOTO_EDIT_MS = 75_000;
const PHOTO_VERIFY_MS = 110_000;
/** Kept back from the edit so its QA call always gets a real chance. */
const PHOTO_VERIFY_RESERVE_MS = 40_000;
/** Don't start an attempt that can't plausibly edit AND verify in time. */
const PHOTO_MIN_ATTEMPT_MS = 70_000;

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
  timeoutMs?: number,
): Promise<{ passes: boolean; ran: boolean; reason: string }> {
  if (!isAiConfigured()) {
    return { passes: false, ran: false, reason: "Verification service not configured." };
  }
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

/** Today's response plus the generation job it was recorded as (absent while
 * the generation_jobs migration is not applied). */
export type PhotoPreviewResponse = PhotoPreviewResult & { jobId?: string };

/** Optional `clientRequestId`: the idempotency key of a job-aware client. */
export type PhotoPreviewInputData = { outfit: DailyLook; clientRequestId?: string };

export const PHOTO_PREVIEW_UNVERIFIED_REASON =
  "Your photo preview couldn't be verified safe this time.";
export const PHOTO_PREVIEW_FAILED_REASON = "Your photo preview couldn't be generated this time.";

/**
 * How a portrait preview job is stored and replayed: the edited photo goes
 * to the generations bucket (the result JSON only names its mode and path);
 * an `unavailable` answer is a refundable failure recorded with a code.
 */
export const photoPreviewJob = {
  settle(result: PhotoPreviewResult): GenerationSettlement {
    if (result.mode === "photo_edit") {
      return { ok: true, result: { mode: "photo_edit" }, imageDataUri: result.imageDataUri };
    }
    return {
      ok: false,
      errorCode:
        result.reason === PHOTO_PREVIEW_UNVERIFIED_REASON
          ? "qa_failed"
          : result.reason === PHOTO_PREVIEW_FAILED_REASON
            ? "render_failed"
            : "rate_limited",
    };
  },
  fromStored({ imageDataUri }: { imageDataUri: string | null }): PhotoPreviewResult {
    return imageDataUri
      ? { imageDataUri, mode: "photo_edit" }
      : { imageDataUri: null, mode: "unavailable", reason: PHOTO_PREVIEW_FAILED_REASON };
  },
  failure(errorCode: string): PhotoPreviewResult {
    return {
      imageDataUri: null,
      mode: "unavailable",
      reason:
        errorCode === "qa_failed" ? PHOTO_PREVIEW_UNVERIFIED_REASON : PHOTO_PREVIEW_FAILED_REASON,
    };
  },
};

/**
 * Renders the single-photo edit preview (the member's own consented selfie
 * with the recommended outfit composited on) — the optional secondary visual
 * beside the style sheet.
 *
 * Shared verbatim by the web `generatePhotoPreview` server function and the
 * mobile `POST /api/v1/look/photo-preview` route.
 *
 * Runs as a generation job once the consent gate passes, exactly like
 * renderStyleSheetForUser: free first render or one credit at job start, the
 * portrait stored at `generations/<uid>/<jobId>.jpg` before it is returned,
 * replay on a repeated `clientRequestId`, one refund (or the free slot handed
 * back) on any failure, and the old `payForLookImage` path until the
 * migration is applied.
 */
export function renderPhotoPreviewForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: PhotoPreviewInputData,
  options?: { inFlight?: "attach" },
): Promise<PhotoPreviewResponse>;
export function renderPhotoPreviewForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: PhotoPreviewInputData,
  options: { inFlight: "report" },
): Promise<PhotoPreviewResponse | GenerationJobRunning>;
export async function renderPhotoPreviewForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: PhotoPreviewInputData,
  options: { inFlight?: "attach" | "report" } = {},
): Promise<PhotoPreviewResponse | GenerationJobRunning> {
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("gender,makeup_preference,hair_length,photo_consent_at,profile_photo_path")
    .eq("id", userId)
    .maybeSingle();

  if (!profileRow?.photo_consent_at || !profileRow?.profile_photo_path) {
    return { imageDataUri: null, mode: "unavailable", reason: "No consented photo on file." };
  }

  // Decided before payForLookImage spends a credit, so a member's last
  // purchased credit still counts them as paid.
  const paidMember = await isPaidStyleMember(supabase, userId);
  const budget = createRenderBudget();

  const render = async (): Promise<PhotoPreviewResult> => {
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
      // Same fix as renderStyleSheetForUser: a thrown error (timeout,
      // network hiccup) used to escape this loop and end the whole
      // function on the first bad attempt, wasting the other retries.
      // Caught per-attempt instead so it's treated like a failed
      // verification and the loop moves on.
      let lastReason = PHOTO_PREVIEW_UNVERIFIED_REASON;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Same budget rule as renderStyleSheetForUser: never start an attempt
        // Vercel's 300s kill would cut off mid-render.
        if (!budget.canStart(PHOTO_MIN_ATTEMPT_MS)) {
          console.warn(
            `[renderPhotoPreviewForUser] stopping before attempt ${attempt}/${MAX_ATTEMPTS} — ${Math.round(budget.remainingMs() / 1000)}s left in the function budget`,
          );
          break;
        }
        try {
          const {
            imageUrl,
            model: imageModel,
            costUsd,
          } = await editOutfitPhoto(
            {
              userPhoto: { bytes: userPhotoBytes, contentType: userPhotoContentType },
              referenceImages: [],
              outfit: data.outfit,
              makeupEnabled,
              hairLength: profileRow.hair_length,
              gender: profileRow.gender,
            },
            {
              enforceSiteQuota: !paidMember,
              timeoutMs: budget.clamp(PHOTO_EDIT_MS, PHOTO_VERIFY_RESERVE_MS),
            },
          );

          const check = () =>
            verifyProtectedRegions(
              originalDataUri,
              imageUrl,
              { supabase, userId },
              budget.clamp(PHOTO_VERIFY_MS),
            );
          let verification = await check();
          if (!verification.ran && budget.canStart(PHOTO_VERIFY_RESERVE_MS)) {
            // The QA call failed to run — the edit was never judged, so
            // re-check the same paid render instead of discarding it.
            verification = await check();
          }

          await logAiSpend(supabase, userId, {
            provider: PHOTO_EDIT_PROVIDER,
            // Whatever model the console has active right now — not a constant.
            model: imageModel,
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
              if (faceMatch.skipped) {
                // Not a verified match — no face was detectable in the
                // reference photo, so this attempt is relying solely on the
                // AI-opinion structural check above. Surfaced distinctly so
                // this doesn't get silently conflated with a real pass.
                console.warn(
                  `[renderPhotoPreviewForUser] face-match check SKIPPED, not verified (attempt ${attempt}/${MAX_ATTEMPTS}):`,
                  faceMatch.reason,
                );
                return { imageDataUri: imageUrl, mode: "photo_edit" };
              }
              // Logged on every attempt (pass or fail) so drift in the
              // image-gen provider — a model update, a prompt regression —
              // shows up in distance trends before it starts failing outright.
              console.log(`[renderPhotoPreviewForUser] face-match distance ${faceMatch.distance}`);
              // Not saved to her history here — same as the text-to-image
              // inspiration path, this is a preview; saveOutfitToHistory
              // uploads it only if/when the user explicitly saves the look.
              // (The generation job keeps a private copy in the generations
              // bucket so a reload can recover it; that is not her history.)
              return { imageDataUri: imageUrl, mode: "photo_edit" };
            }
            console.warn(
              `[renderPhotoPreviewForUser] face-match check failed (attempt ${attempt}/${MAX_ATTEMPTS}):`,
              faceMatch.reason,
              { distance: faceMatch.distance },
            );
            lastReason = PHOTO_PREVIEW_UNVERIFIED_REASON;
            continue;
          }
          console.warn(
            `[renderPhotoPreviewForUser] protected-region check failed (attempt ${attempt}/${MAX_ATTEMPTS}):`,
            verification.reason,
          );
          lastReason = PHOTO_PREVIEW_UNVERIFIED_REASON;
        } catch (attemptError) {
          if (attemptError instanceof ImageProviderRateLimitError) throw attemptError;
          console.warn(
            `[renderPhotoPreviewForUser] attempt ${attempt}/${MAX_ATTEMPTS} threw:`,
            errorMessage(attemptError, "Unknown error"),
          );
          lastReason = PHOTO_PREVIEW_FAILED_REASON;
        }
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
        reason: PHOTO_PREVIEW_FAILED_REASON,
      };
    }
  };

  const outcome = await withGenerationJob<PhotoPreviewResult>(
    {
      kind: "photo_preview",
      userId,
      clientRequestId: data.clientRequestId,
      input: { outfit: data.outfit } as Json,
      charge: true,
      dailyAllowance: await resolveDailyAllowance(supabase, userId),
      deadlineSeconds: GENERATION_DEADLINE_SECONDS,
      inFlight: options.inFlight,
      freeSlot: lookImageFreeSlot(userId),
      settle: photoPreviewJob.settle,
      fromStored: photoPreviewJob.fromStored,
      failure: photoPreviewJob.failure,
      legacy: () => payForLookImage(supabase, userId, render),
    },
    render,
  );
  return outcome.status === "running" ? outcome : withJobId(outcome.value, outcome.jobId);
}
