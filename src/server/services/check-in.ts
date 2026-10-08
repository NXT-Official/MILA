import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { aiChatCompletion, isAiConfigured } from "@/lib/ai.server";
import { withAiCredit } from "@/lib/credits.server";
import { INSUFFICIENT_CREDITS, isInsufficientCreditsError, utcDay } from "@/lib/credits";
import {
  GENERATION_DEADLINE_SECONDS,
  GenerationDeliveredUnsavedError,
  GenerationInFlightError,
  resolveDailyAllowance,
  withGenerationJob,
  withJobId,
  type GenerationJobDeps,
} from "@/lib/generation-jobs.server";
import {
  RateLimitExceededError,
  consumeRateLimit,
  releaseRateLimit,
  type RateLimitPolicy,
  type RateLimitResult,
} from "@/lib/rate-limit.server";
import { captureServerException } from "@/lib/sentry.server";
import { isWaveDMissing } from "@/lib/wave-d-availability";
import {
  CHECK_IN_SYSTEM_PROMPT,
  CHECK_IN_TOOL,
  CHECK_IN_USER_TEXT,
  CheckInReadSchema,
  CheckInReplySchema,
  MAX_PHOTO_TRANSPORT_CHARS,
  PHOTO_TOO_LARGE_COPY,
  READ_TIMEOUT_MS,
  createProviderCallLedger,
  isPhotoTooLarge,
  photoDigest,
  photoPart,
  usableSilhouette,
  type CheckInRead,
} from "./body-read";
import { getBodyScanStatus, type BodyScanStatus } from "./body-scan";
import {
  checkInAvailability,
  freeCheckInSlot,
  type FreeCheckInSlot,
} from "./free-check-in-slot.server";
import type { readProfileExtras } from "./profile-extras.server";

type MilaSupabaseClient = SupabaseClient<Database>;

export type { CheckInRead } from "./body-read";

/**
 * Today's check-in (Wave D plan, D-W3), shared verbatim by the web
 * `runCheckIn` server function and the mobile `POST /api/v1/check-in` route.
 *
 * One AI call reads her skin depth, hair colour, hair length and, from an
 * optional full-length photo, her silhouette. It never reads season,
 * undertone, gender, age, height or weight (R-1).
 *
 * Price: the first check-in each UTC day is free, then 1 credit; at most 5 an
 * hour (R-2, Q3). It runs as a `check_in` generation job, so a double press is
 * charged once and a reload comes back to its result (R7). Every failure gives
 * back the credit or the free slot; the hourly slot is given back only when
 * no billed provider call was made (R-2 amended).
 *
 * Photos are read in memory only (R-4): the job input keeps
 * `{ photos, digest }`, the result keeps the read, and nothing is logged.
 */

export const CHECK_IN_RATE_LIMIT: RateLimitPolicy = { limit: 5, windowSeconds: 3600 };

export const CHECK_IN_RATE_LIMITED = "CHECK_IN_RATE_LIMITED";
export const CHECK_IN_PHOTO_UNUSABLE = "CHECK_IN_PHOTO_UNUSABLE";
export const CHECK_IN_PHOTO_TOO_LARGE = "CHECK_IN_PHOTO_TOO_LARGE";
export const CHECK_IN_UNAVAILABLE = "CHECK_IN_UNAVAILABLE";
export const CHECK_IN_FAILED = "CHECK_IN_FAILED";
export const CONFIG_MISSING_API_KEY = "CONFIG_MISSING_API_KEY";

const photoField = (missing: string) =>
  z.string().min(1, missing).max(MAX_PHOTO_TRANSPORT_CHARS, PHOTO_TOO_LARGE_COPY);

/** The photos are raw base64 (no data URI prefix), as for the colour read. */
export const CheckInInput = z.object({
  faceImageBase64: photoField("Please add a photo of your face."),
  bodyImageBase64: photoField("Please add a full-length photo.").nullish(),
  clientRequestId: z.string().uuid().optional(),
});
export type CheckInInputData = z.infer<typeof CheckInInput>;

/** Failures ride a 200 as `{ success: false, error }` (Wave D plan, 3.3). */
export type CheckInResult =
  { success: true; read: CheckInRead; jobId?: string } | { success: false; error: string };

type CheckInAnswer = { success: true; read: CheckInRead } | { success: false; error: string };

const fail = (error: string): { success: false; error: string } => ({ success: false, error });

/** The codes a stored failure may carry back to her; anything else (a
 * deadline, a persist failure) reads as the plain "couldn't finish". */
const MEMBER_FACING_FAILURES: ReadonlySet<string> = new Set([
  CHECK_IN_PHOTO_UNUSABLE,
  CHECK_IN_FAILED,
]);

export type CheckInDeps = {
  ai?: typeof aiChatCompletion;
  isAiConfigured?: () => boolean;
  /** Whether the Wave D migration is applied (`free_check_in_on` exists). */
  available?: () => Promise<boolean>;
  rateLimit?: (key: string, policy: RateLimitPolicy) => Promise<RateLimitResult>;
  releaseRateLimit?: (key: string, resetAt: RateLimitResult["reset_at"]) => Promise<boolean>;
  freeSlot?: (userId: string, todayUtc: string) => FreeCheckInSlot;
  /** The legacy credit wrapper, used only while generation jobs are missing. */
  withCredit?: typeof withAiCredit;
  dailyAllowance?: (supabase: MilaSupabaseClient, userId: string) => Promise<number>;
  jobs?: GenerationJobDeps;
  now?: () => number;
};

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : typeof err;
}

function checkInFromStored(result: Json | null): CheckInAnswer {
  const read =
    result !== null && typeof result === "object" && !Array.isArray(result)
      ? result.read
      : undefined;
  const parsed = CheckInReadSchema.safeParse(read);
  if (!parsed.success) {
    console.error(JSON.stringify({ event: "check_in_stored_result_invalid" }));
    return fail(CHECK_IN_FAILED);
  }
  return { success: true, read: parsed.data };
}

export async function runCheckInForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: CheckInInputData,
  deps: CheckInDeps = {},
): Promise<CheckInResult> {
  const ai = deps.ai ?? aiChatCompletion;
  const rateLimit = deps.rateLimit ?? consumeRateLimit;
  const release = deps.releaseRateLimit ?? releaseRateLimit;
  const withCredit = deps.withCredit ?? withAiCredit;
  const dailyAllowanceFor = deps.dailyAllowance ?? resolveDailyAllowance;
  const freeSlotFor = deps.freeSlot ?? freeCheckInSlot;
  const now = deps.now ?? Date.now;

  // 1. AI configured.
  if (!(deps.isAiConfigured ?? isAiConfigured)()) {
    console.error("[checkIn] AI provider not configured (OPENROUTER_API_KEY)");
    return fail(CONFIG_MISSING_API_KEY);
  }
  // 2. The Wave D migration: without it there is no free slot to honour, so
  // nothing is charged and no hourly slot is used.
  if (!(await (deps.available ?? checkInAvailability)())) return fail(CHECK_IN_UNAVAILABLE);

  // 3. Size guard (risk K2), before any slot, charge or AI call.
  const face = data.faceImageBase64;
  const body = data.bodyImageBase64 ?? null;
  if (isPhotoTooLarge(face) || isPhotoTooLarge(body)) return fail(CHECK_IN_PHOTO_TOO_LARGE);

  // 4. Five an hour. The window's reset_at is kept exactly as returned, so a
  // release lowers the window that was charged and no other.
  const rateKey = `ai:checkIn:${userId}`;
  let window: RateLimitResult;
  try {
    window = await rateLimit(rateKey, CHECK_IN_RATE_LIMIT);
  } catch (err) {
    if (err instanceof RateLimitExceededError) return fail(CHECK_IN_RATE_LIMITED);
    console.error("[checkIn] the hourly limit could not be checked", describeError(err));
    return fail(CHECK_IN_FAILED);
  }

  const ledger = createProviderCallLedger();
  let slotReleased = false;
  /** R-2 amended: once per request, and only when no billed call was made. */
  const handBackHourlySlot = async () => {
    if (slotReleased || !ledger.mayRelease()) return;
    slotReleased = true;
    await release(rateKey, window.reset_at);
  };

  const photos = body ? [face, body] : [face];
  const input = { photos: body ? ["face", "body"] : ["face"], digest: photoDigest(photos) };
  const freeSlot = freeSlotFor(userId, utcDay(new Date(now())));

  const produce = async (): Promise<CheckInAnswer> => {
    const result = await ledger.call(() =>
      ai(
        [
          { role: "system", content: CHECK_IN_SYSTEM_PROMPT },
          {
            role: "user",
            content: [{ type: "text", text: CHECK_IN_USER_TEXT }, ...photos.map(photoPart)],
          },
        ],
        CHECK_IN_TOOL,
        { supabase, userId },
        { timeoutMs: READ_TIMEOUT_MS },
      ),
    );
    if (!result.ok) {
      console.error(JSON.stringify({ event: "check_in_provider_error", status: result.status }));
      return fail(CHECK_IN_FAILED);
    }
    const parsed = CheckInReplySchema.safeParse(result.args);
    if (!parsed.success) {
      console.error(
        JSON.stringify({
          event: "check_in_reply_invalid",
          fields: Object.keys(parsed.error.flatten().fieldErrors),
        }),
      );
      return fail(CHECK_IN_FAILED);
    }
    const reply = parsed.data;
    if (!reply.faceVisible) return fail(CHECK_IN_PHOTO_UNUSABLE);
    const silhouette = body ? usableSilhouette(reply.silhouette, reply.bodyFullLength) : null;
    return {
      success: true,
      read: {
        skinDepth: reply.skinDepth,
        hairColor: reply.hairColor,
        hairLength: reply.hairLength,
        silhouette,
        bodyPhotoUsable: body ? silhouette !== null : null,
      },
    };
  };

  const releaseFreeSlotQuietly = () =>
    freeSlot.release().catch((err: unknown) => {
      console.error("[checkIn] the free check-in could not be handed back", describeError(err));
      captureServerException(err);
    });

  try {
    const outcome = await withGenerationJob<CheckInAnswer>(
      {
        kind: "check_in",
        userId,
        clientRequestId: data.clientRequestId,
        input,
        charge: true,
        // Today's first check-in claims this instead of a credit.
        freeSlot,
        dailyAllowance: await dailyAllowanceFor(supabase, userId),
        deadlineSeconds: GENERATION_DEADLINE_SECONDS,
        inFlight: "attach",
        settle: (answer) =>
          answer.success
            ? { ok: true, result: { read: answer.read } as unknown as Json }
            : { ok: false, errorCode: answer.error },
        fromStored: ({ result }) => checkInFromStored(result),
        failure: (errorCode) =>
          fail(MEMBER_FACING_FAILURES.has(errorCode) ? errorCode : CHECK_IN_FAILED),
        // Generation jobs are not applied yet: the free slot first, then the
        // credit, each handed back when the read does not succeed.
        legacy: async () => {
          if (await freeSlot.claim()) {
            let answer: CheckInAnswer;
            try {
              answer = await produce();
            } catch (err) {
              await releaseFreeSlotQuietly();
              throw err;
            }
            if (!answer.success) await releaseFreeSlotQuietly();
            return answer;
          }
          return withCredit(supabase, userId, produce, { refundIf: (answer) => !answer.success });
        },
      },
      produce,
      deps.jobs,
    );
    await handBackHourlySlot();
    // `attach` never answers "running"; kept honest all the same.
    if (outcome.status !== "done") return fail(CHECK_IN_FAILED);
    return outcome.value.success ? withJobId(outcome.value, outcome.jobId) : outcome.value;
  } catch (err) {
    // A replay of a check-in made and charged but never stored: answered as
    // `409 DELIVERED_NOT_SAVED`. Not an unbilled refusal, so the slot stays spent.
    if (err instanceof GenerationDeliveredUnsavedError) throw err;
    await handBackHourlySlot();
    // Another check-in with other photos is still being read: answered as
    // `429 RATE_LIMITED` + retryAfter by /api/v1, never as its result.
    if (err instanceof GenerationInFlightError) throw err;
    if (isInsufficientCreditsError(err)) return fail(INSUFFICIENT_CREDITS);
    console.error("[checkIn] the check-in did not finish", describeError(err));
    captureServerException(err);
    return fail(CHECK_IN_FAILED);
  }
}

/** `GET /api/v1/check-in/status` and `getCheckInStatus` (Wave D plan, 3.3). */
export type CheckInStatus = {
  available: boolean;
  freeToday: boolean;
  checkInCost: 0 | 1;
  bodyScan: BodyScanStatus;
};

const CHECK_IN_CLOSED = { available: false, freeToday: false, checkInCost: 1 } as const;

async function readTodaysCheckIn(
  supabase: MilaSupabaseClient,
  userId: string,
  todayUtc: string,
): Promise<Omit<CheckInStatus, "bodyScan">> {
  try {
    // Her own row, read as her (RLS: "Users view own entitlements").
    const { data, error } = await supabase
      .from("user_entitlements")
      .select("free_check_in_on")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      if (!isWaveDMissing(error)) {
        console.error(
          JSON.stringify({ event: "check_in_status_read_error", code: error.code ?? null }),
        );
      }
      return CHECK_IN_CLOSED;
    }
    // No row: nothing could be claimed, so nothing is offered free.
    if (!data) return { available: true, freeToday: false, checkInCost: 1 };
    const claimedOn = data.free_check_in_on;
    const freeToday = claimedOn === null || claimedOn < todayUtc;
    return { available: true, freeToday, checkInCost: freeToday ? 0 : 1 };
  } catch {
    console.error(JSON.stringify({ event: "check_in_status_read_error", code: "thrown" }));
    return CHECK_IN_CLOSED;
  }
}

/**
 * What she can do today, priced. Never throws: a missing migration, a failed
 * read or a missing row answers "not available" or "not free", never a free
 * read on a guess.
 */
export async function getCheckInStatusForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  deps: { now?: () => number; readExtras?: typeof readProfileExtras } = {},
): Promise<CheckInStatus> {
  const today = utcDay(new Date((deps.now ?? Date.now)()));
  const [checkIn, bodyScan] = await Promise.all([
    readTodaysCheckIn(supabase, userId, today),
    getBodyScanStatus(supabase, userId, deps.readExtras),
  ]);
  return { ...checkIn, bodyScan };
}
