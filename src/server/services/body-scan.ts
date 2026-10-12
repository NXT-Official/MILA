import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { BodyType } from "@/constants/style-profile";
import type { Database, Json } from "@/integrations/supabase/types";
import { aiChatCompletion, isAiConfigured } from "@/lib/ai.server";
import { withAiCredit } from "@/lib/credits.server";
import { INSUFFICIENT_CREDITS, isInsufficientCreditsError } from "@/lib/credits";
import {
  GENERATION_DEADLINE_SECONDS,
  GenerationDeliveredUnsavedError,
  GenerationInFlightError,
  resolveDailyAllowance,
  withGenerationJob,
  withJobId,
  type GenerationJobDeps,
  type GenerationJobSpec,
} from "@/lib/generation-jobs.server";
import {
  RateLimitExceededError,
  consumeRateLimit,
  releaseRateLimit,
  type RateLimitPolicy,
  type RateLimitResult,
} from "@/lib/rate-limit.server";
import { captureServerException } from "@/lib/sentry.server";
import {
  BODY_SCAN_SYSTEM_PROMPT,
  BODY_SCAN_TOOL,
  BODY_SCAN_USER_TEXT,
  BodyScanReplySchema,
  MAX_PHOTO_TRANSPORT_CHARS,
  PHOTO_TOO_LARGE_COPY,
  READ_TIMEOUT_MS,
  StoredBodyScanSchema,
  createProviderCallLedger,
  isPhotoTooLarge,
  photoDigest,
  photoPart,
  usableSilhouette,
} from "./body-read";
import { readProfileExtras, type ProfileExtras } from "./profile-extras.server";

type MilaSupabaseClient = SupabaseClient<Database>;

/**
 * The stand-alone body scan (Wave D plan, D-W3): one full-length photo, one
 * AI call, a suggested silhouette. Shared verbatim by the web `runBodyScan`
 * server function and the mobile `POST /api/v1/analysis/body-scan` route.
 *
 * Price (R-2, Q2): her founding scan is free once ever
 * (`profiles.founding_body_read_at`, service-role write only, claimed
 * atomically before the AI call and kept only when a scan succeeds; see
 * `foundingBodyScanSlot`), then 1 credit; at most 10 an hour. It runs as a `body_scan`
 * generation job, so a double press is charged once and a reload comes back
 * to its result (R7). The photo is read in memory only (R-4).
 *
 * A suggestion only: nothing here writes her body type. The client offers it
 * and she chooses (R-3).
 */

export const BODY_SCAN_RATE_LIMIT: RateLimitPolicy = { limit: 10, windowSeconds: 3600 };

export const BODY_SCAN_RATE_LIMITED = "BODY_SCAN_RATE_LIMITED";
export const BODY_SCAN_NOT_FULL_LENGTH = "BODY_SCAN_NOT_FULL_LENGTH";
export const BODY_SCAN_PHOTO_TOO_LARGE = "BODY_SCAN_PHOTO_TOO_LARGE";
export const BODY_SCAN_UNAVAILABLE = "BODY_SCAN_UNAVAILABLE";
export const BODY_SCAN_FAILED = "BODY_SCAN_FAILED";
const CONFIG_MISSING_API_KEY = "CONFIG_MISSING_API_KEY";

/** The photo is raw base64 (no data URI prefix), as for the colour read. */
export const BodyScanInput = z.object({
  bodyImageBase64: z
    .string()
    .min(1, "Please add a full-length photo.")
    .max(MAX_PHOTO_TRANSPORT_CHARS, PHOTO_TOO_LARGE_COPY),
  clientRequestId: z.string().uuid().optional(),
});
export type BodyScanInputData = z.infer<typeof BodyScanInput>;

/** Failures ride a 200 as `{ success: false, error }` (Wave D plan, 3.3). */
export type BodyScanResult =
  { success: true; silhouette: BodyType; jobId?: string } | { success: false; error: string };

type BodyScanAnswer = { success: true; silhouette: BodyType } | { success: false; error: string };

const fail = (error: string): { success: false; error: string } => ({ success: false, error });

const MEMBER_FACING_FAILURES: ReadonlySet<string> = new Set([
  BODY_SCAN_NOT_FULL_LENGTH,
  BODY_SCAN_FAILED,
]);

/** The body scan's entry in `GET /api/v1/check-in/status`. */
export type BodyScanStatus = { available: boolean; free: boolean; cost: 0 | 1 };

/**
 * Fails closed: free only when her Wave D fields were read and her founding
 * scan is unused. A missing migration, a missing row or a failed read is
 * never priced as free.
 */
export function bodyScanPricing(extras: ProfileExtras): BodyScanStatus {
  if (!extras.available) return { available: false, free: false, cost: 1 };
  const free = extras.foundingBodyReadAt === null;
  return { available: true, free, cost: free ? 0 : 1 };
}

export async function getBodyScanStatus(
  supabase: MilaSupabaseClient,
  userId: string,
  read: typeof readProfileExtras = readProfileExtras,
): Promise<BodyScanStatus> {
  return bodyScanPricing(await read(supabase, userId));
}

async function serviceRoleClient(): Promise<MilaSupabaseClient> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/**
 * Spends her founding body scan, with the service role (the column carries no
 * member grant). Only where it is still unset, so the first scan's time
 * stands. Never throws: a failed write is logged, and she keeps her result.
 *
 * Kept (owner rule) for callers that only need to mark the scan spent. The
 * scan itself no longer marks after the fact: it claims the founding scan
 * atomically before the AI call through `foundingBodyScanSlot` (fix round 1,
 * M-1), so two scans can never both run free.
 */
export async function markFoundingBodyReadUsed(
  userId: string,
  admin: () => Promise<MilaSupabaseClient> = serviceRoleClient,
  now: () => number = Date.now,
): Promise<void> {
  try {
    const db = await admin();
    const { data, error } = await db
      .from("profiles")
      .update({ founding_body_read_at: new Date(now()).toISOString() })
      .eq("id", userId)
      .is("founding_body_read_at", null)
      .select("id");
    if (error) {
      console.error(
        JSON.stringify({ event: "founding_body_read_mark_error", code: error.code ?? null }),
      );
    } else if (!data?.length) {
      console.warn(JSON.stringify({ event: "founding_body_read_mark_no_row" }));
    }
  } catch {
    console.error(JSON.stringify({ event: "founding_body_read_mark_error", code: "thrown" }));
  }
}

/** Her founding scan as a generation job's free slot: a claimed slot means no
 * charge; it is handed back when the job is refunded or is someone else's. */
export type FoundingBodyScanSlot = NonNullable<GenerationJobSpec<unknown>["freeSlot"]>;

/**
 * Her once-ever free body scan, claimed atomically (fix round 1, M-1), the
 * same way the free daily check-in is claimed.
 *
 * Claim: one service-role `UPDATE profiles SET founding_body_read_at = now
 * WHERE id = her AND founding_body_read_at IS NULL`. Only one request can win
 * it, so two scans racing can never both run free, however their reads of the
 * marker interleave. It is made before the AI call and kept on success, so a
 * delivered founding scan is spent by construction (no later write that a
 * transient error could skip, M-5).
 *
 * Release: `SET NULL WHERE founding_body_read_at = <the stamp this request
 * wrote>`, only from the slot whose claim won, at most once per won claim. A
 * request that lost the claim can never free the winner's.
 *
 * A failed claim throws: the scan then neither runs free nor is charged on a
 * guess. No migration is needed: the column is 20261008090000's, and while it
 * is missing the scan is hidden before any claim.
 */
export function foundingBodyScanSlot(
  userId: string,
  admin: () => Promise<MilaSupabaseClient> = serviceRoleClient,
  now: () => number = Date.now,
): FoundingBodyScanSlot {
  let heldStamp: string | null = null;
  const slotError = (op: "claim" | "release", code: string | null) => {
    console.error(JSON.stringify({ event: "founding_body_scan_slot_error", op, code }));
    return new Error(
      `The founding body scan could not be ${op === "claim" ? "claimed" : "returned"}.`,
    );
  };
  return {
    claim: async () => {
      const stamp = new Date(now()).toISOString();
      const db = await admin();
      const { data, error } = await db
        .from("profiles")
        .update({ founding_body_read_at: stamp })
        .eq("id", userId)
        .is("founding_body_read_at", null)
        .select("id");
      if (error) throw slotError("claim", error.code ?? null);
      const won = (data?.length ?? 0) > 0;
      if (won) heldStamp = stamp;
      return won;
    },
    release: async () => {
      if (!heldStamp) return;
      const stamp = heldStamp;
      // Cleared before the write: a second release never sends a second update.
      heldStamp = null;
      const db = await admin();
      const { error } = await db
        .from("profiles")
        .update({ founding_body_read_at: null })
        .eq("id", userId)
        .eq("founding_body_read_at", stamp);
      if (error) throw slotError("release", error.code ?? null);
    },
  };
}

export type BodyScanDeps = {
  ai?: typeof aiChatCompletion;
  isAiConfigured?: () => boolean;
  readExtras?: (supabase: MilaSupabaseClient, userId: string) => Promise<ProfileExtras>;
  rateLimit?: (key: string, policy: RateLimitPolicy) => Promise<RateLimitResult>;
  releaseRateLimit?: (key: string, resetAt: RateLimitResult["reset_at"]) => Promise<boolean>;
  /** The legacy credit wrapper, used only while generation jobs are missing. */
  withCredit?: typeof withAiCredit;
  dailyAllowance?: (supabase: MilaSupabaseClient, userId: string) => Promise<number>;
  /** Her founding scan's atomic claim (replaces the after-the-fact marker). */
  foundingSlot?: (userId: string) => FoundingBodyScanSlot;
  jobs?: GenerationJobDeps;
};

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : typeof err;
}

function bodyScanFromStored(result: Json | null): BodyScanAnswer {
  const parsed = StoredBodyScanSchema.safeParse(result);
  if (!parsed.success) {
    console.error(JSON.stringify({ event: "body_scan_stored_result_invalid" }));
    return fail(BODY_SCAN_FAILED);
  }
  return { success: true, silhouette: parsed.data.silhouette };
}

export async function runBodyScanForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: BodyScanInputData,
  deps: BodyScanDeps = {},
): Promise<BodyScanResult> {
  const ai = deps.ai ?? aiChatCompletion;
  const readExtras = deps.readExtras ?? readProfileExtras;
  const rateLimit = deps.rateLimit ?? consumeRateLimit;
  const release = deps.releaseRateLimit ?? releaseRateLimit;
  const withCredit = deps.withCredit ?? withAiCredit;
  const dailyAllowanceFor = deps.dailyAllowance ?? resolveDailyAllowance;
  const foundingSlotFor = deps.foundingSlot ?? ((id: string) => foundingBodyScanSlot(id));

  if (!(deps.isAiConfigured ?? isAiConfigured)()) {
    console.error("[bodyScan] AI provider not configured (OPENROUTER_API_KEY)");
    return fail(CONFIG_MISSING_API_KEY);
  }

  // Her Wave D fields are read before anything is spent. Fail closed: a
  // missing migration hides the scan; a missing row or a failed read refuses
  // it. The price itself is never decided from this read: the founding scan
  // is claimed atomically inside the job (M-1).
  const extras = await readExtras(supabase, userId);
  if (!extras.available) {
    return fail(extras.reason === "missing" ? BODY_SCAN_UNAVAILABLE : BODY_SCAN_FAILED);
  }

  const photo = data.bodyImageBase64;
  if (isPhotoTooLarge(photo)) return fail(BODY_SCAN_PHOTO_TOO_LARGE);

  const rateKey = `ai:bodyScan:${userId}`;
  let window: RateLimitResult;
  try {
    window = await rateLimit(rateKey, BODY_SCAN_RATE_LIMIT);
  } catch (err) {
    if (err instanceof RateLimitExceededError) return fail(BODY_SCAN_RATE_LIMITED);
    console.error("[bodyScan] the hourly limit could not be checked", describeError(err));
    return fail(BODY_SCAN_FAILED);
  }

  const ledger = createProviderCallLedger();
  let slotReleased = false;
  /** R-2 amended (M-2): once per request, only when no call kept the slot. */
  const handBackHourlySlot = async () => {
    if (slotReleased || !ledger.mayRelease()) return;
    slotReleased = true;
    await release(rateKey, window.reset_at);
  };

  const foundingSlot = foundingSlotFor(userId);
  const releaseFoundingQuietly = () =>
    foundingSlot.release().catch((err: unknown) => {
      console.error("[bodyScan] the founding scan could not be handed back", describeError(err));
      captureServerException(err);
    });

  const produce = async (): Promise<BodyScanAnswer> => {
    const result = await ledger.call(() =>
      ai(
        [
          { role: "system", content: BODY_SCAN_SYSTEM_PROMPT },
          {
            role: "user",
            content: [{ type: "text", text: BODY_SCAN_USER_TEXT }, photoPart(photo)],
          },
        ],
        BODY_SCAN_TOOL,
        { supabase, userId },
        { timeoutMs: READ_TIMEOUT_MS },
      ),
    );
    if (!result.ok) {
      console.error(JSON.stringify({ event: "body_scan_provider_error", status: result.status }));
      return fail(BODY_SCAN_FAILED);
    }
    const parsed = BodyScanReplySchema.safeParse(result.args);
    if (!parsed.success) {
      console.error(
        JSON.stringify({
          event: "body_scan_reply_invalid",
          fields: Object.keys(parsed.error.flatten().fieldErrors),
        }),
      );
      return fail(BODY_SCAN_FAILED);
    }
    const silhouette = usableSilhouette(parsed.data.silhouette, parsed.data.bodyFullLength);
    if (!silhouette) return fail(BODY_SCAN_NOT_FULL_LENGTH);
    return { success: true, silhouette };
  };

  try {
    const outcome = await withGenerationJob<BodyScanAnswer>(
      {
        kind: "body_scan",
        userId,
        clientRequestId: data.clientRequestId,
        input: { photos: ["body"], digest: photoDigest([photo]) },
        // Charged unless this request wins her founding scan: the claim is the
        // job's free slot, made before the AI call, handed back exactly once
        // (by this request only) when the job is refunded or is someone
        // else's, and kept on success.
        charge: true,
        freeSlot: foundingSlot,
        dailyAllowance: await dailyAllowanceFor(supabase, userId),
        deadlineSeconds: GENERATION_DEADLINE_SECONDS,
        inFlight: "attach",
        settle: (answer) =>
          answer.success
            ? { ok: true, result: { silhouette: answer.silhouette } as unknown as Json }
            : { ok: false, errorCode: answer.error },
        fromStored: ({ result }) => bodyScanFromStored(result),
        failure: (errorCode) =>
          fail(MEMBER_FACING_FAILURES.has(errorCode) ? errorCode : BODY_SCAN_FAILED),
        // Generation jobs are not applied yet: the same atomic founding claim
        // first (so concurrent founding scans still yield one free), then the
        // credit, each handed back when the scan does not succeed.
        legacy: async () => {
          if (await foundingSlot.claim()) {
            let answer: BodyScanAnswer;
            try {
              answer = await produce();
            } catch (err) {
              await releaseFoundingQuietly();
              throw err;
            }
            if (!answer.success) await releaseFoundingQuietly();
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
    if (outcome.status !== "done") return fail(BODY_SCAN_FAILED);
    return outcome.value.success ? withJobId(outcome.value, outcome.jobId) : outcome.value;
  } catch (err) {
    // A replay of a scan made and charged but never stored: answered as `409
    // DELIVERED_NOT_SAVED`. Not an unbilled refusal, so the slot stays spent.
    if (err instanceof GenerationDeliveredUnsavedError) throw err;
    await handBackHourlySlot();
    // Another scan of a different photo is still being read: answered as
    // `429 RATE_LIMITED` + retryAfter by /api/v1, never as its result.
    if (err instanceof GenerationInFlightError) throw err;
    if (isInsufficientCreditsError(err)) return fail(INSUFFICIENT_CREDITS);
    console.error("[bodyScan] the scan did not finish", describeError(err));
    captureServerException(err);
    return fail(BODY_SCAN_FAILED);
  }
}
