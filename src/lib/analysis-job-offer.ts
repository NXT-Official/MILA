/**
 * What her latest colour read, check-in or body scan job means right now
 * (Wave D plan, section 3.5). A reload or a tab switch comes back to
 * "Still reading", then to the result, instead of losing a paid read.
 *
 * Pure and dependency-free: mobile copies this file verbatim (same path).
 * Times are compared as server times: pass `now` from the server clock where
 * the app has one.
 */

/** How often a running job's row is read again. */
export const ANALYSIS_POLL_MS = 3_000;
/** The reaper fails a running job only this long after its deadline. */
export const ANALYSIS_REAP_GRACE_MS = 30_000;
/**
 * A finished job is offered back until her local day ends, or for this long
 * after it finished, whichever is later (the shared recovery rule: the same as
 * a look's `isRecentLook` and the feature jobs' offer).
 */
export const ANALYSIS_OFFER_WINDOW_MS = 12 * 60 * 60 * 1000;
/** How many dismissed job ids each app remembers. */
export const ANALYSIS_DISMISSED_LIMIT = 20;
/**
 * The server delivered the result to the request that asked and kept the
 * charge, but could not store it. Never a failure, never refunded.
 */
export const PERSIST_FAILED_DELIVERED = "persist_failed_delivered";

export type AnalysisJobOffer = "running" | "stale" | "ready" | "failed";

/** The fields of a job row this decision reads. */
export type AnalysisJobLike = {
  id: string;
  status: string;
  result: unknown;
  errorCode: string | null;
  deadlineAt: string;
  completedAt: string | null;
  /** When the job started; stands in for `completedAt` when that is missing. */
  createdAt?: string | null;
};

export type AnalysisJobOfferContext = {
  /** Now, in ms since the epoch (server time where known). */
  now: number;
  /** Jobs she dismissed (or chose a result from): never offered again. */
  dismissedIds?: readonly string[];
  /** color_read: the job her saved dossier already came from. */
  usedJobId?: string | null;
  /**
   * When she last saved what this kind of job would change. A job that
   * finished at or before it is never offered.
   * - check_in: profiles.last_check_in_at.
   * - color_read: when her current colour profile was saved (a read or a quiz).
   */
  appliedAt?: string | null;
  /**
   * Whether a succeeded job's result is one this kind can show. Only `true`
   * counts; a check that throws reads as "does not parse". Default: any JSON
   * object (never null, text or a list).
   */
  resultParses?: (result: unknown) => boolean;
  /** Whether two instants fall on the same local day. Defaults to the device's calendar. */
  sameLocalDay?: (a: number, b: number) => boolean;
};

/**
 * A Postgres timestamp in ms. Fractions beyond milliseconds are cut first, so
 * PostgREST's microsecond text reads the same on every JS engine.
 */
function timeOf(value: string | null | undefined): number {
  if (typeof value !== "string" || value.length === 0) return Number.NaN;
  return Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
}

function isObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function defaultSameLocalDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function resultIsOfferable(result: unknown, check: (result: unknown) => boolean): boolean {
  try {
    return check(result) === true;
  } catch {
    return false;
  }
}

export function analysisJobOffer(
  job: AnalysisJobLike | null | undefined,
  ctx: AnalysisJobOfferContext,
): AnalysisJobOffer | null {
  if (!job) return null;

  if (job.status === "running") {
    const deadline = timeOf(job.deadlineAt);
    if (!Number.isFinite(deadline)) return null;
    return ctx.now <= deadline + ANALYSIS_REAP_GRACE_MS ? "running" : "stale";
  }

  if (job.status !== "succeeded" && job.status !== "failed") return null;
  if (ctx.dismissedIds?.includes(job.id)) return null;

  // Finished on her local day, or within the last 12 hours (so 23:58 still
  // counts at 00:02). Both times are the server's.
  const finished = timeOf(job.completedAt ?? job.createdAt);
  if (!Number.isFinite(finished)) return null;
  const sameDay = (ctx.sameLocalDay ?? defaultSameLocalDay)(finished, ctx.now);
  const recent = ctx.now >= finished && ctx.now - finished <= ANALYSIS_OFFER_WINDOW_MS;
  if (!sameDay && !recent) return null;

  if (job.status === "failed") {
    return job.errorCode === PERSIST_FAILED_DELIVERED ? null : "failed";
  }

  if (!resultIsOfferable(job.result, ctx.resultParses ?? isObject)) return null;
  if (ctx.usedJobId && job.id === ctx.usedJobId) return null;
  const applied = timeOf(ctx.appliedAt);
  if (Number.isFinite(applied) && applied >= finished) return null;
  return "ready";
}

/** Her dismissed ids with `id` added last: the newest 20, no duplicates. */
export function rememberDismissed(ids: readonly string[], id: string): string[] {
  return [...ids.filter((existing) => existing !== id), id].slice(-ANALYSIS_DISMISSED_LIMIT);
}
