import { InsufficientCreditsError } from "../../src/lib/credits";
import {
  GENERATION_JOB_KINDS,
  GenerationImageExistsError,
  GenerationJobStoreError,
  GenerationJobsUnavailableError,
  type GenerationJobRow,
  type GenerationJobStore,
  type StartGenerationJobArgs,
} from "../../src/lib/generation-jobs.server";
import { DomainValidationError } from "../../src/server/http/api-errors";
import type { Json } from "../../src/integrations/supabase/types";

/** Mirrors the reaper's grace period in `reap_generation_jobs`. */
const REAP_GRACE_MS = 30_000;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** What PostgREST answers when a jsonb argument holds a string jsonb cannot
 * store: NUL is 22P05, a lone surrogate is 22P02. Raised before the function
 * runs, so nothing moves. Null when the value is storable. */
function jsonbRefusal(value: unknown): string | null {
  const strings: string[] = [];
  const walk = (item: unknown) => {
    if (typeof item === "string") strings.push(item);
    else if (Array.isArray(item)) item.forEach(walk);
    else if (item !== null && typeof item === "object") {
      for (const [key, inner] of Object.entries(item)) {
        strings.push(key);
        walk(inner);
      }
    }
  };
  walk(value);
  if (strings.some((text) => text.includes("\u0000"))) {
    return "unsupported Unicode escape sequence";
  }
  if (strings.some((text) => LONE_SURROGATE.test(text))) {
    return "invalid input syntax for type json";
  }
  return null;
}

type Balance = { daily: number; purchased: number };
/** `user_entitlements`: `ai_credits` is today's pool only while
 * `credits_reset_at` is today (UTC), exactly as consume_ai_credit reads it. */
type Entitlement = Balance & { resetAt: string };

/**
 * An in-memory `generation_jobs` + credit ledger that follows
 * `supabase/migrations/20261007143000_generation_jobs.sql` (Revision 2):
 * - start: same request id = 'existing' (no charge), a running job of the
 *   kind = 'in_flight' (no charge), else insert + charge through
 *   consume_ai_credit (daily pool after the UTC reset, then purchased), with
 *   owed daily refunds landed around the spend, a refused spend retried when
 *   one landed, and an allowance-first swap; one transaction (a raise rolls
 *   back everything it did, its own reap included);
 * - a refund happens exactly once and only for a failed, charged job:
 *   purchased -> purchased at once; daily -> today's daily pool, at once when
 *   that pool is stamped for today, otherwise owed (refund_applied_at null)
 *   until a stamp lands it, once; never into purchased;
 * - complete / fail only write rows that are still running;
 * - knobs make each persistence step fail on demand.
 */
export class MemoryGenerationJobStore implements GenerationJobStore {
  rows: GenerationJobRow[] = [];
  images = new Map<string, { bytes: Uint8Array; contentType: string }>();
  entitlements = new Map<string, Entitlement>();
  calls = { start: 0, complete: 0, fail: 0, refunds: 0, uploads: 0, get: 0, reap: 0 };
  /** Every database call throws as if the migration were not applied. */
  missing = false;
  failUpload = false;
  failComplete = false;
  /** Fail only the next N uploads / completes, then work. */
  failUploadTimes = 0;
  failCompleteTimes = 0;
  /** The next N uploads land, then lose their answer on the wire. */
  loseUploadAnswerTimes = 0;
  /** complete_generation_job commits, then the answer is lost on the wire. */
  loseCompleteAnswer = false;
  /** fail_generation_job_with_result (20261008100000) is not applied: a fail
   * with a result does what the Supabase store then does, a plain
   * fail_generation_job. The refund is unchanged; the result is not kept. */
  missingFailWithResult = false;
  private seq = 0;

  constructor(private now: () => number = Date.now) {}

  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  /** Seeds today's pool (stamped today unless `resetAt` says otherwise). */
  seed(userId: string, daily: number, purchased = 0, resetAt = this.today()) {
    this.entitlements.set(userId, { daily, purchased, resetAt });
  }

  balance(userId: string): Balance {
    const e = this.entitlement(userId);
    return { daily: e.daily, purchased: e.purchased };
  }

  entitlement(userId: string): Entitlement {
    const e = this.entitlements.get(userId) ?? { daily: 0, purchased: 0, resetAt: "" };
    return { ...e };
  }

  private guard() {
    if (this.missing) throw new GenerationJobsUnavailableError("generation_jobs is not installed");
  }

  async get(jobId: string) {
    this.guard();
    this.calls.get += 1;
    const row = this.rows.find((r) => r.id === jobId);
    // The real adapter polls every column except `input` and returns it null.
    return row ? { ...row, input: null } : null;
  }

  async start(args: StartGenerationJobArgs) {
    this.guard();
    this.calls.start += 1;
    // start_generation_job is one transaction: a raise (insufficient credits)
    // rolls back everything it did first, its own reap and refunds included.
    const before = {
      rows: this.rows.map((r) => ({ ...r })),
      entitlements: new Map([...this.entitlements].map(([k, v]) => [k, { ...v }])),
      refunds: this.calls.refunds,
    };
    try {
      return this.startInTransaction(args);
    } catch (err) {
      this.rows = before.rows;
      this.entitlements = before.entitlements;
      this.calls.refunds = before.refunds;
      throw err;
    }
  }

  private startInTransaction(args: StartGenerationJobArgs) {
    // The SQL validates its arguments before anything moves (P0001 raises,
    // which the adapter turns into a calm GenerationJobStoreError).
    if (!(GENERATION_JOB_KINDS as readonly string[]).includes(args.kind)) {
      throw new GenerationJobStoreError("invalid_generation_kind");
    }
    if (!args.clientRequestId) throw new GenerationJobStoreError("invalid_client_request_id");
    const deadline = Math.ceil(args.deadlineSeconds);
    if (deadline < 1 || deadline > 3600) {
      throw new GenerationJobStoreError("invalid_deadline_seconds");
    }

    this.reapNow(args.userId);

    const sameRequest = this.rows.find(
      (r) => r.user_id === args.userId && r.client_request_id === args.clientRequestId,
    );
    if (sameRequest) {
      if (sameRequest.kind !== args.kind) {
        throw new DomainValidationError("That request was already used for something else.");
      }
      return { outcome: "existing" as const, job: { ...sameRequest } };
    }

    const running = this.rows.find(
      (r) => r.user_id === args.userId && r.kind === args.kind && r.status === "running",
    );
    if (running) return { outcome: "in_flight" as const, job: { ...running } };

    this.seq += 1;
    const createdAt = this.now();
    const row: GenerationJobRow = {
      id: `00000000-0000-4000-9000-${String(this.seq).padStart(12, "0")}`,
      user_id: args.userId,
      kind: args.kind,
      client_request_id: args.clientRequestId,
      status: "running",
      credit_state: "none",
      charged_from: null,
      input: args.input,
      result: null,
      image_path: null,
      error_code: null,
      deadline_at: new Date(createdAt + args.deadlineSeconds * 1000).toISOString(),
      created_at: new Date(createdAt).toISOString(),
      completed_at: null,
      refund_applied_at: null,
    };
    this.rows.push(row);

    if (args.charge) {
      const purchasedBefore = this.entitlement(args.userId).purchased;
      this.applyOwed(args.userId);
      let allowed = this.consume(args.userId, args.dailyAllowance);
      // consume stamped today's pool (even when it refused): owed refunds from
      // an earlier day can land now; a refused spend they can pay is retried.
      let landed = this.applyOwed(args.userId);
      if (!allowed && landed > 0) {
        allowed = this.consume(args.userId, args.dailyAllowance);
        landed = 0;
      }
      if (!allowed) throw new InsufficientCreditsError();

      let purchasedAfter = this.entitlement(args.userId).purchased;
      if (purchasedAfter < purchasedBefore && landed > 0) {
        // Allowance first: spend the daily credit that just landed instead.
        const e = this.entitlement(args.userId);
        this.entitlements.set(args.userId, {
          ...e,
          daily: e.daily - 1,
          purchased: e.purchased + 1,
        });
        purchasedAfter = purchasedBefore;
      }
      row.credit_state = "charged";
      row.charged_from = purchasedAfter < purchasedBefore ? "purchased" : "daily";
    }
    return { outcome: "started" as const, job: { ...row } };
  }

  async complete(jobId: string, result: Json, imagePath: string | null) {
    this.guard();
    this.calls.complete += 1;
    const refusal = jsonbRefusal(result);
    if (refusal) throw new Error(refusal);
    if (this.failComplete) throw new Error("complete_generation_job failed");
    if (this.failCompleteTimes > 0) {
      this.failCompleteTimes -= 1;
      throw new Error("complete_generation_job failed");
    }
    const row = this.mustFind(jobId);
    if (row.status !== "running") return { outcome: "not_running" as const, job: { ...row } };
    if (
      imagePath !== null &&
      (!imagePath.startsWith(`${row.user_id}/`) ||
        imagePath.includes("..") ||
        imagePath.length > 512)
    ) {
      throw new Error("invalid_image_path");
    }
    row.status = "succeeded";
    row.result = result;
    row.image_path = imagePath;
    row.completed_at = this.stamp();
    if (this.loseCompleteAnswer) throw new Error("connection reset after commit");
    return { outcome: "completed" as const, job: { ...row } };
  }

  /** fail_generation_job, or fail_generation_job_with_result when a result is
   * given: that result is written only on the running -> failed transition. */
  async fail(jobId: string, errorCode: string, refund: boolean, result?: Json | null) {
    this.guard();
    this.calls.fail += 1;
    const keep =
      result === undefined || result === null || this.missingFailWithResult ? null : result;
    const refusal = keep === null ? null : jsonbRefusal(keep);
    if (refusal) throw new Error(refusal);
    // fail_generation_job_with_result raises invalid_result before anything
    // moves: only a JSON object of at most 65 536 bytes. (Postgres measures
    // jsonb's own text, which spaces after ':' and ','; this measures compact
    // JSON, so the real function may refuse a result a little sooner.)
    if (
      keep !== null &&
      (typeof keep !== "object" ||
        Array.isArray(keep) ||
        Buffer.byteLength(JSON.stringify(keep), "utf8") > 65_536)
    ) {
      throw new Error("invalid_result");
    }
    const row = this.mustFind(jobId);
    let outcome: "failed" | "not_running" = "not_running";
    if (row.status === "running") {
      row.status = "failed";
      // coalesce(nullif(left(btrim(p_error_code), 200), ''), 'unknown')
      row.error_code = errorCode.trim().slice(0, 200) || "unknown";
      if (keep !== null) row.result = keep;
      row.completed_at = this.stamp();
      outcome = "failed";
    }
    if (refund) this.refund(row);
    return { outcome, job: { ...row } };
  }

  async reap(userId: string | null = null): Promise<number> {
    this.guard();
    this.calls.reap += 1;
    return this.reapNow(userId);
  }

  async uploadImage(path: string, bytes: Uint8Array, contentType: string) {
    this.calls.uploads += 1;
    if (this.failUpload) throw new Error("upload failed");
    if (this.failUploadTimes > 0) {
      this.failUploadTimes -= 1;
      throw new Error("upload failed");
    }
    // The real store uploads with upsert:false: an existing object is a conflict.
    if (this.images.has(path)) throw new GenerationImageExistsError("The resource already exists");
    this.images.set(path, { bytes, contentType });
    if (this.loseUploadAnswerTimes > 0) {
      this.loseUploadAnswerTimes -= 1;
      throw new Error("connection reset after the object was stored");
    }
  }

  async downloadImage(path: string) {
    const image = this.images.get(path);
    if (!image) throw new Error("object not found");
    return image;
  }

  private mustFind(jobId: string): GenerationJobRow {
    const row = this.rows.find((r) => r.id === jobId);
    if (!row) throw new Error("generation_job_not_found");
    return row;
  }

  /** `consume_ai_credit`: resets the pool on a new day, spends daily then
   * purchased, and stamps today even when it refuses. */
  private consume(userId: string, dailyAllowance: number): boolean {
    if (!(dailyAllowance >= 0)) throw new GenerationJobStoreError("invalid_daily_allowance");
    if (!this.entitlements.has(userId)) {
      throw new GenerationJobStoreError("entitlements_not_found");
    }
    const e = this.entitlement(userId);
    const today = this.today();
    let daily = e.resetAt === today ? e.daily : dailyAllowance;
    let purchased = e.purchased;
    let allowed = true;
    if (daily > 0) daily -= 1;
    else if (purchased > 0) purchased -= 1;
    else allowed = false;
    this.entitlements.set(userId, { daily, purchased, resetAt: today });
    return allowed;
  }

  /** `apply_owed_generation_refunds`: lands owed daily refunds, once each,
   * only into a pool stamped for today. */
  private applyOwed(userId: string): number {
    const e = this.entitlement(userId);
    if (e.resetAt !== this.today()) return 0;
    const owed = this.rows.filter(
      (r) =>
        r.user_id === userId &&
        r.credit_state === "refunded" &&
        r.charged_from === "daily" &&
        r.refund_applied_at === null,
    );
    for (const row of owed) row.refund_applied_at = this.stamp();
    if (owed.length > 0) this.entitlements.set(userId, { ...e, daily: e.daily + owed.length });
    return owed.length;
  }

  private reapNow(userId: string | null): number {
    let reaped = 0;
    for (const row of this.rows) {
      if (userId && row.user_id !== userId) continue;
      if (row.status !== "running") continue;
      if (Date.parse(row.deadline_at) + REAP_GRACE_MS >= this.now()) continue;
      row.status = "failed";
      row.error_code = "deadline_exceeded";
      row.completed_at = this.stamp();
      this.refund(row);
      reaped += 1;
    }
    if (userId) this.applyOwed(userId);
    return reaped;
  }

  /** `refund_generation_job_credit`: only a failed, still-charged job, once. */
  private refund(row: GenerationJobRow) {
    if (row.status !== "failed" || row.credit_state !== "charged" || !row.charged_from) return;
    row.credit_state = "refunded";
    this.calls.refunds += 1;
    if (row.charged_from === "purchased") {
      row.refund_applied_at = this.stamp();
      const e = this.entitlement(row.user_id);
      this.entitlements.set(row.user_id, { ...e, purchased: e.purchased + 1 });
    } else {
      row.refund_applied_at = null;
      this.applyOwed(row.user_id);
    }
  }
}
