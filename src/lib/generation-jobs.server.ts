import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { DomainValidationError } from "@/server/http/api-errors";
import { createAvailabilityCache, type AvailabilityCache } from "./availability-cache";
import { InsufficientCreditsError } from "./credits";
import { grantAiCredits, markLookImagePending } from "./credits.server";
import { DELIVERED_NOT_SAVED, DELIVERED_NOT_SAVED_MESSAGE } from "./generation-error-codes";
import { RateLimitExceededError } from "./rate-limit.server";
import { captureServerException } from "./sentry.server";

/**
 * Generation jobs (R7): a paid generation is recorded before it runs, its
 * result is persisted before the member is answered, and every way it can
 * fail hands the credit back exactly once. Backed by
 * `supabase/migrations/20261007143000_generation_jobs.sql`; until that
 * migration is applied every caller runs its own legacy path unchanged.
 */

export const GENERATION_JOB_KINDS = [
  "look",
  "style_sheet",
  "photo_preview",
  "color_read",
  "check_in",
  "body_scan",
  "lens_analysis",
  "dupe_search",
  "concierge",
  "item_detection",
] as const;
export type GenerationJobKind = (typeof GENERATION_JOB_KINDS)[number];

export type GenerationJobRow = {
  id: string;
  user_id: string;
  kind: GenerationJobKind;
  client_request_id: string;
  status: "running" | "succeeded" | "failed";
  credit_state: "none" | "charged" | "refunded";
  charged_from: "daily" | "purchased" | null;
  input: Json;
  result: Json | null;
  image_path: string | null;
  error_code: string | null;
  deadline_at: string;
  created_at: string;
  completed_at: string | null;
  /** When a refund actually landed in a balance (Revision 2). A refunded daily
   * credit stays owed (null) until today's pool exists. Optional: polled rows
   * and rows from before the column may not carry it. */
  refund_applied_at?: string | null;
};

export type StartGenerationJobArgs = {
  userId: string;
  kind: GenerationJobKind;
  clientRequestId: string;
  input: Json;
  charge: boolean;
  dailyAllowance: number;
  deadlineSeconds: number;
};

/** The persistence the wrapper needs, one method per migration function plus
 * the private `generations` bucket. The default talks to Supabase with the
 * service role; tests pass an in-memory twin. */
export interface GenerationJobStore {
  start(
    args: StartGenerationJobArgs,
  ): Promise<{ outcome: "started" | "existing" | "in_flight"; job: GenerationJobRow }>;
  complete(
    jobId: string,
    result: Json,
    imagePath: string | null,
  ): Promise<{ outcome: "completed" | "not_running"; job: GenerationJobRow }>;
  /** With a `result` (a JSON object), the failed row keeps it: a refunded
   * result the member can still come back to. Written only on the running ->
   * failed transition; the refund is the same either way. */
  fail(
    jobId: string,
    errorCode: string,
    refund: boolean,
    result?: Json | null,
  ): Promise<{ outcome: "failed" | "not_running"; job: GenerationJobRow }>;
  get(jobId: string): Promise<GenerationJobRow | null>;
  reap(userId?: string | null): Promise<number>;
  uploadImage(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  downloadImage(path: string): Promise<{ bytes: Uint8Array; contentType: string }>;
}

/** The migration is not applied yet (table or function missing). */
export class GenerationJobsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationJobsUnavailableError";
  }
}

/** The job's image object already exists. Its path holds the server-minted
 * job id, so the object can only be this job's own earlier upload whose
 * answer was lost: the persist retry treats it as uploaded. */
export class GenerationImageExistsError extends Error {
  constructor(message = "The job's image is already stored.") {
    super(message);
    this.name = "GenerationImageExistsError";
  }
}

/** A store call failed for a reason the member can't act on. The raw database
 * error is logged, never shown. */
export class GenerationJobStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GenerationJobStoreError";
  }
}

/**
 * Another request of the same generation is still running and this caller
 * cannot be told `{ status: 'running' }` (it sent no clientRequestId, so it
 * predates jobs). Extends RateLimitExceededError so `/api/v1` answers the
 * existing `429 RATE_LIMITED` + `retryAfter` the mobile client already
 * handles, with no change to the error taxonomy.
 */
export class GenerationInFlightError extends RateLimitExceededError {
  constructor(retryAfterSeconds: number) {
    super(retryAfterSeconds);
    this.name = "GenerationInFlightError";
    this.message = "Mila is still finishing your last request. Try again in a moment.";
  }
}

/** The keep-the-charge code: the result was delivered (and charged) but could
 * not be stored, so there is nothing to answer a replay with. */
const PERSIST_FAILED_DELIVERED = "persist_failed_delivered";

/**
 * A replay (or an attached caller) found a job that was delivered and charged
 * but whose result could not be stored: there is nothing to show again. Not a
 * failure to retry: a new request id is a new, charged generation. `/api/v1`
 * answers 409 `DELIVERED_NOT_SAVED`; web server functions surface the
 * message. Code and copy come from the client-safe `generation-error-codes`,
 * so clients match it with `isDeliveredNotSaved`.
 */
export class GenerationDeliveredUnsavedError extends Error {
  readonly code = DELIVERED_NOT_SAVED;

  constructor(readonly jobId: string) {
    super(DELIVERED_NOT_SAVED_MESSAGE);
    this.name = "GenerationDeliveredUnsavedError";
  }
}

export type GenerationJobRunning = { status: "running"; jobId: string };

export type GenerationJobOutcome<T> =
  { status: "done"; jobId: string | null; value: T; replayed: boolean } | GenerationJobRunning;

/** How a produced value is stored: a success (JSON + an optional rendered
 * image as a data URI, uploaded to storage) or a refundable failure, which
 * may keep a result on its failed row (a JSON object of at most
 * MAX_JOB_RESULT_CHARS bytes and no inline image; anything else is dropped,
 * and the job is still failed and refunded). */
export type GenerationSettlement =
  | { ok: true; result: Json; imageDataUri?: string | null }
  | { ok: false; errorCode: string; result?: Json };

/**
 * What a produce (and the legacy path) asks before it writes a side effect of
 * its own (a History row, a conversation turn, `post_items`): is this still
 * the live job she is charged for? Past its deadline the wrapper fails the job
 * and refunds it while produce may still be running; a write after that would
 * be value she was refunded for.
 *
 * Check `stillRunning()` immediately before the write, skip the write on
 * false, and make the write the last thing produce does (anything that can
 * throw after it turns into "side effect plus refund").
 *
 * The margin: the wrapper gives up on a job at its produce deadline (the
 * job's deadline minus the 15 s persist reserve, so 285 s of 300). A true
 * answer from `stillRunning()` marks a write as under way, and at that
 * deadline the wrapper then waits up to 10 s more (the write grace, inside
 * the reserve) for produce to finish:
 * - it finishes in time: the job is completed as usual (delivered, charged);
 * - it does not: the job is failed and refunded. Only a write that itself
 *   outlasts the grace can land after that refund, and the reaper (30 s past
 *   the job's deadline) is beyond it.
 * The grace covers only a write confirmed before the produce deadline: from
 * that deadline on, every new `stillRunning()` answers false, during the
 * grace too, so no write can start inside it.
 * Without a true answer there is no grace: the job is failed at the deadline.
 * So call it only right before the write, not as an early check.
 * The produce deadline is timed from when produce starts, so the work done
 * before it (the caller's own, plus the reap, free-slot and start calls)
 * also has to fit inside the 5 s of the reserve the grace leaves.
 */
export type GenerationWriteGuard = {
  /** Aborts (reason: a "TimeoutError" DOMException) when the wrapper gives up
   * on the job: at the produce deadline, or at the end of the write grace
   * when a write is under way. Always before the failure and refund are
   * written. Pass it to the AI call so abandoned work stops. Never aborts on
   * the legacy path. */
  signal: AbortSignal;
  /** True while this job is still running and its produce deadline has not
   * passed; a true answer marks the write as under way (see the grace above).
   * False from the produce deadline on (during the grace too), or when the
   * job's row (re-read with the service role) is no longer running, or cannot
   * be read: no write on a guess. Always true on the legacy path, which has
   * no job. */
  stillRunning: () => Promise<boolean>;
};

/** What `produce` is called with. */
export type GenerationJobContext = GenerationWriteGuard & { jobId: string };

/** What `legacy` is called with: no job, so nothing to check against. */
export type LegacyGenerationContext = GenerationWriteGuard & { jobId: null };

export type GenerationJobSpec<T> = {
  kind: GenerationJobKind;
  userId: string;
  /** The client's idempotency key. Absent for clients that predate jobs: the
   * server picks one, so the request is still recorded and charged once. */
  clientRequestId?: string | null;
  input: Json;
  charge: boolean;
  dailyAllowance: number;
  /** At least the route's maximum duration: the reaper refunds a job still
   * running 30 s after this. */
  deadlineSeconds: number;
  /** 'report' answers `{ status: 'running', jobId }` while another request of
   * this job is in flight; 'attach' (default) waits for it and answers with
   * its result, for callers that cannot handle the running shape. */
  inFlight?: "attach" | "report";
  /** A free render slot (the look's first visual): claimed before the job
   * starts, so a claimed slot means no charge, and handed back instead of a
   * credit when the job fails or turns out to be someone else's. */
  freeSlot?: { claim: () => Promise<boolean>; release: () => Promise<void> };
  settle: (value: T) => GenerationSettlement;
  /** Rebuilds today's response from a succeeded job (a replay). */
  fromStored: (stored: { result: Json | null; imageDataUri: string | null }) => T;
  /** The response for a failed job (replayed, or this request's persist or
   * deadline failure). May throw, for kinds that answer failures by throwing.
   * `stored` is given when the answer comes from a failed row: its `result`
   * is what a refundable failure kept (null when it kept nothing). */
  failure: (errorCode: string, stored?: { result: Json | null }) => T;
  /** Today's path, run unchanged while the migration is not applied. Its
   * context's `stillRunning()` is always true, so a produce body shared with
   * the legacy path writes exactly as it does today. */
  legacy: (context: LegacyGenerationContext) => Promise<T>;
};

export { createAvailabilityCache, type AvailabilityCache };

const instanceAvailability = createAvailabilityCache();

export type GenerationJobDeps = {
  store?: GenerationJobStore;
  availability?: AvailabilityCache;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  newRequestId?: () => string;
  /** Kept back from the deadline for the upload + complete write. */
  persistReserveMs?: number;
  pollMs?: number;
  maxAttachMs?: number;
  /** Runs `callback` after `ms` and answers a cancel: the deadline timers.
   * Real timers by default; tests pass virtual time. */
  schedule?: Schedule;
};

export type Schedule = (callback: () => void, ms: number) => () => void;

const realSchedule: Schedule = (callback, ms) => {
  // Deliberately not unref'd: when the work hangs, this timer is the only
  // thing left that can fail the job and refund it.
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
};

/** Vercel ends a function at 300 s: the deadline every job here records. */
export const GENERATION_DEADLINE_SECONDS = 300;
const DEFAULT_PERSIST_RESERVE_MS = 15_000;
/** Of the persist reserve, how long past the produce deadline a write that
 * stillRunning() said yes to may take to finish. The other 5 s stay for
 * persisting: a write that finished but whose job was never completed
 * before the function is ended would be refunded by the reaper. */
const WRITE_GRACE_MS = 10_000;
const DEFAULT_POLL_MS = 2_000;
/** An attached caller stops waiting before its own function is ended. */
const DEFAULT_MAX_ATTACH_MS = 270_000;
const ATTACH_SLACK_MS = 5_000;
/** `reap_generation_jobs` fails a running job only this long after its
 * deadline; an attached caller waits that long before it reaps a dead job. */
const REAP_GRACE_MS = 30_000;
/** The reaper uses the database clock; the wait uses the server's. This much
 * disagreement is waited out before giving up on a dead job. */
const REAP_SKEW_ALLOWANCE_MS = 15_000;
/** Self-reap attempts while waiting behind a dead job (each is a no-op until
 * the database agrees the grace has passed, or a transient error). */
const MAX_SELF_REAPS = 8;
/** The first persist plus one retry on the same path. */
const PERSIST_ATTEMPTS = 2;
/** The keep-the-charge fail call plus one retry. */
const KEEP_CHARGE_ATTEMPTS = 2;

/** JSON with object keys sorted at every depth, so a request's input compares
 * equal to the same input read back from jsonb, which reorders keys. A key
 * whose value is undefined or null is dropped: JSON drops undefined, and in
 * these inputs a null optional field means the same as a missing one (web
 * sends `faceShape: null` where mobile omits it). Array positions are kept. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined && record[key] !== null)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const TIMED_OUT = Symbol("timed-out");

/** `onTimeout` runs the moment the deadline passes: after the timeout has
 * won the race (so work that rejects as it is aborted, like a fetch given the
 * signal, can't turn the deadline into a thrown error), but in the same tick,
 * so anything it marks (the produce's abort signal) is seen before the job's
 * failure is written. */
async function raceDeadline<T>(
  work: Promise<T>,
  ms: number,
  options: {
    schedule: Schedule;
    onTimeout?: () => void;
    /** Called once, at the deadline (which it may record): how much longer
     * the work may run before it times out (a write under way gets its grace;
     * anything else, none). */
    graceMs?: () => number;
  },
): Promise<T | typeof TIMED_OUT> {
  const cancels: (() => void)[] = [];
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    const expire = () => {
      resolve(TIMED_OUT);
      try {
        options.onTimeout?.();
      } catch (err) {
        // Never in the way of the refund that follows the race.
        console.error("[withGenerationJob] marking a job past its deadline failed", err);
      }
    };
    cancels.push(
      options.schedule(() => {
        const grace = options.graceMs?.() ?? 0;
        if (grace > 0) cancels.push(options.schedule(expire, grace));
        else expire();
      }, ms),
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    for (const cancel of cancels) cancel();
  }
}

const DATA_URI_PATTERN = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const INLINE_IMAGE_PATTERN = /data:[a-z]+\/[a-z0-9.+-]+;base64,/i;

/** The most a job row's `result` may hold: its JSON, counted in UTF-8 bytes
 * (64 KB). Bytes, not UTF-16 characters, because that is the unit the
 * database measures (`octet_length` in fail_generation_job_with_result). */
export const MAX_JOB_RESULT_CHARS = 65_536;

/** NUL and a lone surrogate, as JSON.stringify writes them (`\u0000`,
 * `\ud83d`; a valid pair is written as itself). jsonb refuses both: 22P05 and
 * 22P02. */
const JSONB_UNSAFE_ESCAPE = /\\u(0000|d[89a-f][0-9a-f]{2})/i;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function jsonbSafeString(text: string): string {
  return text.replaceAll("\u0000", "").replace(LONE_SURROGATE, "");
}

function stripJsonbUnsafe(value: Json): Json {
  if (typeof value === "string") return jsonbSafeString(value);
  if (Array.isArray(value)) return value.map((item) => stripJsonbUnsafe(item));
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: Json | undefined } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[jsonbSafeString(key)] = stripJsonbUnsafe(item);
    }
    return out;
  }
  return value;
}

/**
 * The value as jsonb can store it: NUL and lone surrogates (an emoji cut in
 * half by a UTF-16 slice) removed from every string and key, valid pairs
 * kept. A value with nothing to remove comes back as the same object. Every
 * stored result goes through this, so no kind's row write can be refused for
 * a character an AI or a trim produced.
 */
// src: https://www.postgresql.org/docs/current/datatype-json.html (8.14: jsonb rejects
//   \u0000 and requires correct surrogate pairs) · PostgreSQL 15+
export function toJsonbSafe(value: Json): Json {
  const json = JSON.stringify(value);
  if (json === undefined || !JSONB_UNSAFE_ESCAPE.test(json)) return value;
  // Parsed back from its own JSON, so it is plain data (no toJSON, no Date).
  return stripJsonbUnsafe(JSON.parse(json) as Json);
}

/** Why a result may not be stored on a job row, or null when it may. Never
 * an inline image (images live in the bucket), never over the size cap. */
function guardResult(result: Json): string | null {
  const json = JSON.stringify(result);
  if (INLINE_IMAGE_PATTERN.test(json)) {
    return "A job result must never inline an image; store it in the bucket.";
  }
  if (Buffer.byteLength(json, "utf8") > MAX_JOB_RESULT_CHARS) {
    return `A job result must stay within ${MAX_JOB_RESULT_CHARS} bytes.`;
  }
  return null;
}

/** The result a refundable failure may keep on its failed row: a JSON object
 * that passes guardResult. Anything else is dropped (and reported, since it
 * is a settle bug); the job is still failed and refunded. */
function keepableFailureResult(result: Json | undefined): Json | undefined {
  if (result === undefined || result === null) return undefined;
  let safe: Json = result;
  let refusal: string | null;
  try {
    // What jsonb would refuse (NUL, a lone surrogate) is removed, never a
    // reason to lose the result or to leave the job unrefunded.
    safe = toJsonbSafe(result);
    refusal =
      safe !== null && typeof safe === "object" && !Array.isArray(safe)
        ? guardResult(safe)
        : "A failed job may only keep a JSON object.";
  } catch (err) {
    refusal = `A failed job's result could not be read as JSON: ${String(err)}`;
  }
  if (refusal === null) return safe;
  const error = new Error(`[withGenerationJob] failure result dropped: ${refusal}`);
  console.error(error.message);
  captureServerException(error);
  return undefined;
}

/** A rendered image's data URI as bytes + type, or null when it is anything
 * other than a base64 jpeg/png/webp. */
export function dataUriToImage(
  dataUri: string,
): { bytes: Uint8Array; contentType: string; extension: string } | null {
  const match = DATA_URI_PATTERN.exec(dataUri.trim());
  if (!match) return null;
  const [, contentType, format, base64] = match;
  return {
    bytes: new Uint8Array(Buffer.from(base64, "base64")),
    contentType,
    extension: format === "jpeg" ? "jpg" : format,
  };
}

function bytesToDataUri(bytes: Uint8Array, contentType: string): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** The thrown error's class name when it is a plain identifier, so admin
 * observability can tell an AI outage from a validation failure. */
function errorCodeFor(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) && name !== "Error" ? name : "produce_failed";
}

function withImagePath(result: Json, imagePath: string | null): Json {
  if (!imagePath || result === null || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  return { ...result, image_path: imagePath };
}

/**
 * Runs one paid generation as a job. See the module comment; the order is:
 * start (charge or replay or attach) → produce, raced against the deadline →
 * persist (image upload, then complete) → answer. Any failure after the
 * charge fails the job with a refund, exactly once.
 */
export async function withGenerationJob<T>(
  spec: GenerationJobSpec<T>,
  produce: (job: GenerationJobContext) => Promise<T>,
  deps: GenerationJobDeps = {},
): Promise<GenerationJobOutcome<T>> {
  const store = deps.store ?? supabaseGenerationJobStore;
  const availability = deps.availability ?? instanceAvailability;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const legacy = async (): Promise<GenerationJobOutcome<T>> => ({
    status: "done",
    jobId: null,
    // No job and no deadline race: today's path writes exactly as it does today.
    value: await spec.legacy({
      jobId: null,
      signal: new AbortController().signal,
      stillRunning: async () => true,
    }),
    replayed: false,
  });
  const fallBackToLegacy = async (err: unknown): Promise<GenerationJobOutcome<T>> => {
    availability.markMissing();
    // Reported once per cache window, never silent: once the migration is
    // applied, a "missing" function here means drift that switches R7 off.
    console.warn("[withGenerationJob] generation jobs unavailable; running the legacy path", err);
    captureServerException(err);
    return legacy();
  };
  if (availability.isMissing()) return legacy();

  const requestId = spec.clientRequestId ?? (deps.newRequestId ?? (() => crypto.randomUUID()))();

  // The member's overdue jobs are reaped in their own call first: start reaps
  // too, but an insufficient-credits raise inside start rolls that back, and a
  // dead job's refund may be exactly the credit this request needs. Being the
  // first call, it also finds a missing migration before a free slot is
  // claimed.
  try {
    await store.reap(spec.userId);
  } catch (err) {
    if (err instanceof GenerationJobsUnavailableError) return fallBackToLegacy(err);
    console.error("[withGenerationJob] reaping overdue jobs failed; start reaps again", err);
  }

  const freeClaimed = spec.freeSlot ? await spec.freeSlot.claim() : false;
  const releaseFreeSlot = async () => {
    if (!freeClaimed || !spec.freeSlot) return;
    await spec.freeSlot.release().catch((err: unknown) => {
      console.error("[withGenerationJob] free render slot could not be handed back", err);
      captureServerException(err);
    });
  };

  let started: Awaited<ReturnType<GenerationJobStore["start"]>>;
  try {
    started = await store.start({
      userId: spec.userId,
      kind: spec.kind,
      clientRequestId: requestId,
      input: spec.input,
      charge: spec.charge && !freeClaimed,
      dailyAllowance: spec.dailyAllowance,
      deadlineSeconds: spec.deadlineSeconds,
    });
  } catch (err) {
    await releaseFreeSlot();
    if (err instanceof GenerationJobsUnavailableError) return fallBackToLegacy(err);
    throw err;
  }

  /** "Try again later", timed to when the job is surely over: its deadline
   * while it may still be alive, the reaper's grace once it is overdue. */
  const retryLater = (job: GenerationJobRow) => {
    const deadline = Date.parse(job.deadline_at);
    const over = now() < deadline ? deadline : deadline + REAP_GRACE_MS;
    return new GenerationInFlightError(Math.max(1, Math.ceil((over - now()) / 1000)));
  };

  /**
   * A job this request did not start: replay it, report it, or wait for it.
   * `otherRequest`: it is another request's job of this kind (SQL
   * `in_flight`), whose result is this request's answer only when it was
   * asked with the same input (a double press, a second tab, a retry).
   */
  const answerExisting = async (
    job: GenerationJobRow,
    otherRequest = false,
  ): Promise<GenerationJobOutcome<T>> => {
    if (job.status === "succeeded") {
      let imageDataUri: string | null = null;
      if (job.image_path) {
        try {
          const image = await store.downloadImage(job.image_path);
          imageDataUri = bytesToDataUri(image.bytes, image.contentType);
        } catch (err) {
          console.error("[withGenerationJob] stored image could not be read", err);
          throw new GenerationJobStoreError("Mila couldn't load that result. Please try again.", {
            cause: err,
          });
        }
      }
      return {
        status: "done",
        jobId: job.id,
        value: spec.fromStored({ result: job.result, imageDataUri }),
        replayed: true,
      };
    }
    if (job.status === "failed") {
      // Delivered and charged, but never stored: not a failure, and nothing
      // to replay. Every kind answers the same way, before its own failure.
      if (job.error_code === PERSIST_FAILED_DELIVERED) {
        throw new GenerationDeliveredUnsavedError(job.id);
      }
      // A refundable failure may have kept a result (a refunded hunt): handed
      // over with the failure, so a replay answers what the member saw.
      return {
        status: "done",
        jobId: job.id,
        value: spec.failure(job.error_code ?? "failed", { result: job.result ?? null }),
        replayed: true,
      };
    }
    if (otherRequest && stableJson(job.input) !== stableJson(spec.input)) {
      // A different outfit or vibe is still rendering: its result would land
      // on the wrong look. Ask her to try again once it is done instead.
      throw retryLater(job);
    }
    if (spec.inFlight === "report") return { status: "running", jobId: job.id };

    // Wait for it. A job killed with its server stays "running" until the
    // reaper's grace has passed, so the wait runs that long and then reaps it
    // (refunding it) rather than giving up on a job that can never finish.
    // The reaper judges the grace on the database clock, so the self-reap is
    // retried on each poll (bounded) for as long as the clocks may disagree.
    const deadline = Date.parse(job.deadline_at);
    const waitUntil = Math.min(
      deadline + REAP_GRACE_MS + REAP_SKEW_ALLOWANCE_MS + ATTACH_SLACK_MS,
      now() + (deps.maxAttachMs ?? DEFAULT_MAX_ATTACH_MS),
    );
    let selfReapsLeft = MAX_SELF_REAPS;
    const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
    // Bounded by count as well as by clock, so the wait ends even if the
    // clock it is given never moves.
    let pollsLeft = Math.ceil((waitUntil - now()) / Math.max(1, pollMs)) + 1;
    while (now() < waitUntil && pollsLeft > 0) {
      pollsLeft -= 1;
      await sleep(pollMs);
      if (selfReapsLeft > 0 && now() > deadline + REAP_GRACE_MS) {
        selfReapsLeft -= 1;
        await store.reap(spec.userId).catch((err: unknown) => {
          console.error("[withGenerationJob] reaping a dead job while waiting failed", err);
        });
      }
      let current: GenerationJobRow | null;
      try {
        current = await store.get(job.id);
      } catch (err) {
        // One failed poll is not the job's answer: keep waiting.
        console.error("[withGenerationJob] polling a running job failed; still waiting", err);
        continue;
      }
      if (current && current.status !== "running") return answerExisting(current);
    }
    throw retryLater(job);
  };

  if (started.outcome !== "started") {
    await releaseFreeSlot();
    return answerExisting(started.job, started.outcome === "in_flight");
  }

  const jobId = started.job.id;
  /** Fails the job, with its refund unless told otherwise, keeping `result`
   * on the failed row when one is given; answers the row when it had already
   * finished (null when even that could not be read). */
  const failJob = async (
    errorCode: string,
    refund = true,
    result?: Json,
  ): Promise<GenerationJobRow | null> => {
    try {
      // Without a result the call is exactly today's (three arguments).
      const failed =
        result === undefined
          ? await store.fail(jobId, errorCode, refund)
          : await store.fail(jobId, errorCode, refund, result);
      // Failed by this call, or already failed by the reaper while this
      // request was still producing: either way a free slot it held is owed
      // back (the reaper cannot re-mark it) whenever the job is refunded.
      if (refund && failed.job.status === "failed") await releaseFreeSlot();
      return failed.outcome === "not_running" ? failed.job : null;
    } catch (err) {
      // The reaper refunds it once the deadline passes.
      console.error(`[withGenerationJob] could not fail job ${jobId}`, err);
      captureServerException(err);
      return null;
    }
  };
  const failed = async (errorCode: string): Promise<GenerationJobOutcome<T>> => {
    const alreadyFinished = await failJob(errorCode);
    // A complete write whose answer was lost still succeeded: the member paid
    // for that result and gets it, never a failure for a stored look.
    if (alreadyFinished?.status === "succeeded") return answerExisting(alreadyFinished);
    return { status: "done", jobId, value: spec.failure(errorCode), replayed: false };
  };

  const produceMs = Math.max(
    0,
    spec.deadlineSeconds * 1000 - (deps.persistReserveMs ?? DEFAULT_PERSIST_RESERVE_MS),
  );
  // The race does not cancel produce: past the deadline the job is failed and
  // refunded while produce may still run. The signal and stillRunning() let
  // it stop, and skip any write of its own, instead of handing out value
  // she was refunded for.
  const deadline = new AbortController();
  // A write stillRunning() said yes to is under way: at the deadline produce
  // gets the write grace to finish before the job is failed and refunded.
  let writeUnderWay = false;
  // Set by the produce deadline itself (before any grace, and before the
  // abort): from then on every new check answers false, so the grace covers
  // only the write already confirmed, never one that starts inside it.
  let pastProduceDeadline = false;
  const writeGraceMs = Math.min(
    WRITE_GRACE_MS,
    deps.persistReserveMs ?? DEFAULT_PERSIST_RESERVE_MS,
  );
  const stillRunning = async (): Promise<boolean> => {
    // The clock first: past the deadline the failure and refund are under
    // way (or a confirmed write is finishing) even while the row still reads
    // "running".
    if (pastProduceDeadline) return false;
    try {
      const row = await store.get(jobId);
      const live = row?.status === "running" && !pastProduceDeadline;
      // Set in the same continuation as the deadline check above: the
      // deadline either sees this write and waits for it, or has already
      // passed and the answer is false. Never a yes the deadline does not
      // know about.
      if (live) writeUnderWay = true;
      return live;
    } catch (err) {
      console.error(
        `[withGenerationJob] could not re-read job ${jobId}; not writing on a guess`,
        err,
      );
      return false;
    }
  };
  let value: T;
  try {
    const raced = await raceDeadline(
      produce({ jobId, signal: deadline.signal, stillRunning }),
      produceMs,
      {
        schedule: deps.schedule ?? realSchedule,
        graceMs: () => {
          pastProduceDeadline = true;
          return writeUnderWay ? writeGraceMs : 0;
        },
        onTimeout: () =>
          deadline.abort(
            new DOMException(`The ${spec.kind} job ran past its deadline.`, "TimeoutError"),
          ),
      },
    );
    if (raced === TIMED_OUT) {
      console.error(`[withGenerationJob] ${spec.kind} job ${jobId} ran past its deadline`);
      return failed("deadline_exceeded");
    }
    value = raced;
  } catch (err) {
    captureServerException(err);
    await failJob(errorCodeFor(err));
    throw err;
  }

  let settled: GenerationSettlement | null = null;
  let persistError: unknown = null;
  try {
    settled = spec.settle(value);
  } catch (err) {
    persistError = err;
  }
  if (settled && !settled.ok) {
    // A refundable failure answer (an unavailable render, a hunt with nothing
    // close): refund, keep its result when it may be kept, answer it.
    await failJob(settled.errorCode, true, keepableFailureResult(settled.result));
    return { status: "done", jobId, value, replayed: false };
  }

  // Persist: image first, then the row. Retried once on the same
  // deterministic path; upsert stays off, so an upload that landed but lost
  // its answer comes back as "already exists" and counts as uploaded.
  let imageUploaded = false;
  const persist = async (success: Extract<GenerationSettlement, { ok: true }>) => {
    // Stored as jsonb can hold it (NUL and lone surrogates removed); she is
    // answered with the value as produced. An inline image or an oversized
    // result is never stored: it takes the persist-failure path below
    // (delivered, charge kept, reported).
    const result = toJsonbSafe(success.result);
    const refusal = guardResult(result);
    if (refusal) throw new Error(refusal);
    let imagePath: string | null = null;
    if (success.imageDataUri) {
      const image = dataUriToImage(success.imageDataUri);
      if (!image) throw new Error("The rendered image was not a supported data URI.");
      imagePath = `${spec.userId}/${jobId}.${image.extension}`;
      if (!imageUploaded) {
        try {
          await store.uploadImage(imagePath, image.bytes, image.contentType);
        } catch (err) {
          if (!(err instanceof GenerationImageExistsError)) throw err;
        }
        imageUploaded = true;
      }
    }
    return store.complete(jobId, withImagePath(result, imagePath), imagePath);
  };
  let completed: Awaited<ReturnType<GenerationJobStore["complete"]>> | null = null;
  if (settled) {
    for (let attempt = 1; attempt <= PERSIST_ATTEMPTS && !completed; attempt += 1) {
      try {
        completed = await persist(settled);
      } catch (err) {
        persistError = err;
        console.error(
          `[withGenerationJob] persisting ${spec.kind} job ${jobId} failed (attempt ${attempt}/${PERSIST_ATTEMPTS})`,
          err,
        );
      }
    }
  }

  /**
   * This request's own job had already finished when it tried to write it.
   * Succeeded: its own complete committed but the answer was lost, so the
   * value in hand IS the stored result (no re-download). Failed: it was
   * reaped past its deadline and refunded, so she gets the failure, never the
   * value as well; a free render gets its slot back.
   */
  const ownJobFinished = async (job: GenerationJobRow): Promise<GenerationJobOutcome<T>> => {
    if (job.status === "succeeded") return { status: "done", jobId, value, replayed: false };
    await releaseFreeSlot();
    return answerExisting(job);
  };

  if (!completed) {
    // Coordinator ruling 2026-10-07: the value is in hand, so she gets it and
    // the charge stands (she received what she paid for). Refunding here
    // turned any persist failure into a free generation. Reported loudly so
    // storage failures are seen. The charge is recorded with one retry.
    let recorded = false;
    let keepError: unknown = null;
    for (let attempt = 1; attempt <= KEEP_CHARGE_ATTEMPTS && !recorded; attempt += 1) {
      try {
        const kept = await store.fail(jobId, PERSIST_FAILED_DELIVERED, false);
        const ownEarlierKeep =
          kept.job.status === "failed" && kept.job.error_code === PERSIST_FAILED_DELIVERED;
        // Reaped (and refunded) or completed in the meantime: answer that. A
        // row already marked persist_failed_delivered is this loop's own
        // earlier attempt that committed but lost its answer: recorded.
        if (kept.outcome === "not_running" && !ownEarlierKeep) return ownJobFinished(kept.job);
        recorded = true;
      } catch (err) {
        keepError = err;
      }
    }
    if (recorded) {
      console.error(
        `[withGenerationJob] ${spec.kind} job ${jobId} delivered without being stored; the charge is kept`,
        persistError,
      );
      captureServerException(persistError);
    } else {
      // The database is unreachable: the job stays "running", so the reaper
      // will refund it 30 s after its deadline. Say so, and report both.
      console.error(
        `[withGenerationJob] ${spec.kind} job ${jobId} delivered without being stored, and the job could not be marked: the reaper will refund it`,
        persistError,
        keepError,
      );
      captureServerException(persistError);
      captureServerException(keepError);
    }
    // Not stored, so there is no job to follow: no jobId.
    return { status: "done", jobId: null, value, replayed: false };
  }

  if (completed.outcome === "not_running") return ownJobFinished(completed.job);
  return { status: "done", jobId, value, replayed: false };
}

/** Adds `jobId` to today's response when a job exists (never on the legacy path). */
export function withJobId<T extends object>(
  value: T,
  jobId: string | null,
): T & { jobId?: string } {
  return jobId ? { ...value, jobId } : value;
}

/**
 * The daily allowance consume_ai_credit is called with today. credits.server.ts
 * keeps that rule private; grantAiCredits resolves it and hands it to its store
 * seam, so a capturing store reads the very same number and writes nothing.
 */
export async function resolveDailyAllowance(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  return grantAiCredits(supabase, userId, 0, async (_userId, dailyAllowance) => dailyAllowance);
}

/**
 * The look's free first visual (`user_entitlements.look_image_pending`) as a
 * job free slot. Claim is the same conditional update payForLookImage makes
 * (credits.server.ts), release re-marks it the way its refund does.
 */
export function lookImageFreeSlot(userId: string): GenerationJobSpec<unknown>["freeSlot"] {
  return {
    claim: async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("user_entitlements")
        .update({ look_image_pending: false })
        .eq("user_id", userId)
        .eq("look_image_pending", true)
        .select("user_id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    release: () => markLookImagePending(userId),
  };
}

/** Fails + refunds overdue running jobs, for one member or (null) everyone.
 * `available: false` while the migration is not applied. */
export async function reapGenerationJobs(
  userId: string | null,
  store: GenerationJobStore = supabaseGenerationJobStore,
): Promise<{ available: boolean; reaped: number }> {
  try {
    return { available: true, reaped: await store.reap(userId) };
  } catch (err) {
    if (err instanceof GenerationJobsUnavailableError) return { available: false, reaped: 0 };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Supabase store (service role)
// ---------------------------------------------------------------------------

// src: https://docs.postgrest.org/en/v12/references/errors.html (PGRST202: function not
//   in the schema cache) · PostgREST 12; PGRST205 (table not in the schema cache) · PostgREST 13
// src: https://www.postgresql.org/docs/current/errcodes-appendix.html (42P01 undefined_table,
//   42883 undefined_function)
const MISSING_CODES = new Set(["PGRST202", "PGRST205", "42P01", "42883"]);

type PostgrestLikeError = { code?: string; message?: string };

/** The function-missing subset of MISSING_CODES: what an unapplied
 * fail_generation_job_with_result answers while its table exists. */
const FUNCTION_MISSING_CODES = new Set(["PGRST202", "42883"]);

/** The one call into 20261008100000_generation_job_fail_with_result.sql.
 * Typed here because the generated Database types predate that migration;
 * the row is checked by toRow like every other job row. Called as a method,
 * so the client keeps its `this`. */
// src: node_modules/@supabase/postgrest-js · 2.110.0 (rpc on a set-returning function
//   answers an array; .single() takes its one row, as fail_generation_job's call does)
type FailWithResultRpcClient = {
  rpc: (
    fn: "fail_generation_job_with_result",
    args: { p_job_id: string; p_error_code: string; p_refund: boolean; p_result: Json },
  ) => { single: () => PromiseLike<{ data: unknown; error: PostgrestLikeError | null }> };
};

export function toGenerationJobStoreError(op: string, error: PostgrestLikeError): Error {
  if (error.code && MISSING_CODES.has(error.code)) {
    return new GenerationJobsUnavailableError(`${op}: ${error.code}`);
  }
  // Raised by the migration's functions as SQLSTATE P0001 with these messages.
  if (error.message === "insufficient_credits") return new InsufficientCreditsError();
  if (error.message === "client_request_id_conflict") {
    return new DomainValidationError(
      "That request was already used for something else. Please try again.",
    );
  }
  console.error(`[generation-jobs] ${op} failed`, error);
  return new GenerationJobStoreError("Mila couldn't record that request. Please try again.", {
    cause: error,
  });
}

const JOB_STATUSES = new Set(["running", "succeeded", "failed"]);

/** The row as PostgREST returns it (composite `job` column), checked. */
function toRow(raw: unknown): GenerationJobRow {
  const row = raw as GenerationJobRow | null;
  if (!row || typeof row.id !== "string" || !JOB_STATUSES.has(row.status)) {
    throw new GenerationJobStoreError("Mila couldn't read that request. Please try again.");
  }
  return row;
}

async function admin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const GENERATIONS_BUCKET = "generations";

/** The service-role client the store talks through: `SupabaseClient<Database>`. */
export type AdminClient = SupabaseClient<Database>;

/** Polls never need the input or result jsonb of a running job re-read every
 * 2 s: everything but `input` (result is needed once it has succeeded). */
const POLLED_COLUMNS =
  "id,user_id,kind,client_request_id,status,credit_state,charged_from,result,image_path,error_code,deadline_at,created_at,completed_at,refund_applied_at";

/** storage-js reports an upload onto an existing object (upsert off) as a
 * 409 "Duplicate" / "The resource already exists". */
function isStorageConflict(error: { message?: string; status?: unknown; statusCode?: unknown }) {
  return (
    error.status === 409 ||
    String(error.statusCode) === "409" ||
    /already exists|duplicate/i.test(error.message ?? "")
  );
}

/**
 * The store over Supabase with the given (service-role) client. Exported as a
 * factory so the adapter can be exercised against the real supabase-js client
 * with a stubbed fetch that answers exactly what PostgREST and Storage answer.
 */
// src: https://supabase.com/docs/reference/javascript/rpc · supabase-js 2.110.0 — a
//   table-returning function answers an array; `.single()` takes its one row. The
//   migration's functions return exactly one `{ outcome, job }` row.
export function createSupabaseGenerationJobStore(
  getClient: () => Promise<AdminClient>,
  options: {
    /** Remembers that `fail_generation_job_with_result`
     * (20261008100000_generation_job_fail_with_result.sql) is not applied.
     * One per store; the module's store is the instance every request shares. */
    failWithResultAvailability?: AvailabilityCache;
  } = {},
): GenerationJobStore {
  const failWithResultAvailability =
    options.failWithResultAvailability ?? createAvailabilityCache();

  const plainFail = async (jobId: string, errorCode: string, refund: boolean) => {
    const db = await getClient();
    const { data, error } = await db
      .rpc("fail_generation_job", { p_job_id: jobId, p_error_code: errorCode, p_refund: refund })
      .single();
    if (error) throw toGenerationJobStoreError("fail_generation_job", error);
    return {
      outcome: data?.outcome === "failed" ? ("failed" as const) : ("not_running" as const),
      job: toRow(data?.job),
    };
  };

  return {
    async start(args) {
      const db = await getClient();
      const { data, error } = await db
        .rpc("start_generation_job", {
          p_user_id: args.userId,
          p_kind: args.kind,
          p_client_request_id: args.clientRequestId,
          p_input: args.input,
          p_charge: args.charge,
          p_daily_allowance: args.dailyAllowance,
          p_deadline_seconds: Math.ceil(args.deadlineSeconds),
        })
        .single();
      if (error) throw toGenerationJobStoreError("start_generation_job", error);
      const outcome = data?.outcome;
      if (outcome !== "started" && outcome !== "existing" && outcome !== "in_flight") {
        console.error("[generation-jobs] start_generation_job answered an unknown shape", data);
        throw new GenerationJobStoreError("Mila couldn't record that request. Please try again.");
      }
      return { outcome, job: toRow(data.job) };
    },

    async complete(jobId, result, imagePath) {
      const db = await getClient();
      const { data, error } = await db
        .rpc("complete_generation_job", {
          p_job_id: jobId,
          p_result: result,
          // Sent as an explicit null: PostgREST resolves a function by its named
          // arguments, and the migration gives p_image_path no default.
          p_image_path: imagePath,
        })
        .single();
      if (error) throw toGenerationJobStoreError("complete_generation_job", error);
      return {
        outcome: data?.outcome === "completed" ? "completed" : "not_running",
        job: toRow(data?.job),
      };
    },

    async fail(jobId, errorCode, refund, result) {
      if (result === undefined || result === null || failWithResultAvailability.isMissing()) {
        return plainFail(jobId, errorCode, refund);
      }
      const db = (await getClient()) as unknown as FailWithResultRpcClient;
      const { data, error } = await db
        .rpc("fail_generation_job_with_result", {
          p_job_id: jobId,
          p_error_code: errorCode,
          p_refund: refund,
          p_result: result,
        })
        .single();
      if (error) {
        if (error.code && FUNCTION_MISSING_CODES.has(error.code)) {
          // Only this function is missing (20261008100000 not applied yet):
          // jobs stay on, the refund is unchanged, the result is not kept.
          // Reported once per cache window, never silent.
          failWithResultAvailability.markMissing();
          console.warn(
            "[generation-jobs] fail_generation_job_with_result unavailable; failing without keeping the result",
            error.code,
          );
          captureServerException(
            new GenerationJobsUnavailableError(`fail_generation_job_with_result: ${error.code}`),
          );
          return plainFail(jobId, errorCode, refund);
        }
        // Any other error drops the result, never the refund: a plain fail
        // follows at once, so the job never waits for the reaper. That is
        // safe even when it is unclear whether this call committed: both
        // functions write running -> failed only on a running row and refund
        // through the same exactly-once guard, so a plain fail after a
        // committed call refunds nothing. Cases seen:
        // - invalid_result: the wrapper guards results first, measuring
        //   compact JSON, while jsonb's own text (what the database measures)
        //   spaces after ':' and ','; a result just under the cap can still
        //   be refused (raised before anything changed).
        // - 22P02 / 22P05: a string jsonb cannot hold (a lone surrogate, a
        //   NUL) that got past toJsonbSafe.
        // - an outage or a lost connection.
        // Rare and worth seeing. Only when the plain fail fails too is the
        // error thrown (and the reaper refunds after the deadline).
        console.error(
          `[generation-jobs] fail_generation_job_with_result failed (${error.code || error.message}); failing without keeping the result`,
          error,
        );
        captureServerException(
          new GenerationJobStoreError(
            `fail_generation_job_with_result: ${error.code || error.message}`,
            {
              cause: error,
            },
          ),
        );
        return plainFail(jobId, errorCode, refund);
      }
      const row = data as { outcome?: unknown; job?: unknown } | null;
      return {
        outcome: row?.outcome === "failed" ? "failed" : "not_running",
        job: toRow(row?.job),
      };
    },

    async get(jobId) {
      const db = await getClient();
      const { data, error } = await db
        .from("generation_jobs")
        .select(POLLED_COLUMNS)
        .eq("id", jobId)
        .maybeSingle();
      if (error) throw toGenerationJobStoreError("generation_jobs read", error);
      // `input` is not polled; nothing that reads a polled row uses it.
      return data ? toRow({ ...data, input: null }) : null;
    },

    async reap(userId = null) {
      const db = await getClient();
      const { data, error } = await db.rpc(
        "reap_generation_jobs",
        userId ? { p_user_id: userId } : {},
      );
      if (error) throw toGenerationJobStoreError("reap_generation_jobs", error);
      return typeof data === "number" ? data : 0;
    },

    // src: https://supabase.com/docs/reference/javascript/storage-from-upload · supabase-js
    //   2.110.0 — fileBody accepts an ArrayBufferView; upsert defaults to false, so a job's
    //   object is written once and never overwritten.
    async uploadImage(path, bytes, contentType) {
      const db = await getClient();
      const { error } = await db.storage
        .from(GENERATIONS_BUCKET)
        .upload(path, bytes, { contentType, upsert: false });
      if (error) {
        if (isStorageConflict(error as Parameters<typeof isStorageConflict>[0])) {
          throw new GenerationImageExistsError();
        }
        console.error("[generation-jobs] image upload failed", error.message);
        throw new GenerationJobStoreError("Mila couldn't save that image. Please try again.", {
          cause: error,
        });
      }
    },

    // src: https://supabase.com/docs/reference/javascript/storage-from-download · supabase-js
    //   2.110.0 — answers `{ data: Blob, error }`.
    async downloadImage(path) {
      const db = await getClient();
      const { data, error } = await db.storage.from(GENERATIONS_BUCKET).download(path);
      if (error || !data) {
        throw new GenerationJobStoreError("Mila couldn't load that image. Please try again.", {
          cause: error,
        });
      }
      return {
        bytes: new Uint8Array(await data.arrayBuffer()),
        contentType: data.type || "image/jpeg",
      };
    },
  };
}

export const supabaseGenerationJobStore: GenerationJobStore =
  createSupabaseGenerationJobStore(admin);
