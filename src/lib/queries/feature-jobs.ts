import { queryOptions, type Query, type QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { queryKeys } from "@/constants/query-keys";
import { createAvailabilityCache, type AvailabilityCache } from "@/lib/availability-cache";
import { memberAuthorization } from "@/lib/auth-session";
import { featureJobOffer, FEATURE_JOB_KINDS, type FeatureJobKind } from "@/lib/feature-job-offer";
import { memberQueryRetry } from "@/lib/queries/member-query";
import { errorMessage, isStaleBundleError } from "@/lib/utils";

/**
 * Her latest Lens, Dupe hunt, Concierge or item-detection job (P2b plan, W0),
 * so a reload or a tab switch comes back to "still working", then to the
 * result, a refund or a calm failure. What a row means is decided by
 * `featureJobOffer` (src/lib/feature-job-offer.ts).
 *
 * Reads `public.generation_jobs` (RLS: she reads only her own rows) with her
 * own Authorization header. Until its migration is applied the table is
 * missing and every read answers `{ status: "unavailable" }`: remembered for
 * 5 minutes, with no polling, no offers and no "you can leave" copy.
 *
 * Shares the ["generation-jobs", userId] key prefix with the dashboard's job
 * queries, so their reaper refreshes these rows too. Imports no job module.
 */

export type FeatureJobsClient = SupabaseClient<Database>;

export const FEATURE_JOB_COLUMNS =
  "id,kind,client_request_id,status,credit_state,result,error_code,input,deadline_at,created_at,completed_at";

/** How often a running row is read again. */
export const FEATURE_POLL_MS = 3_000;
/** How often her own call in flight checks its row. */
export const FEATURE_IN_FLIGHT_POLL_MS = 10_000;
const IDLE_STALE_MS = 60_000;
const UNAVAILABLE_STALE_MS = 5 * 60_000;
/** Every read gives up after this long (a read that hangs is a failure, not a wait). */
export const FEATURE_READ_TIMEOUT_MS = 8_000;

export const featureJobKeys = {
  all: (userId: string | undefined) => ["generation-jobs", userId] as const,
  latest: (userId: string | undefined, kind: FeatureJobKind) =>
    ["generation-jobs", userId, kind] as const,
};

/** One mutation key per kind, so a call in flight is found again after the page remounts. */
export function featureMutationKey(kind: FeatureJobKind) {
  return ["generation", kind] as const;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** What the row's `input` ties it to. Matching is by these links only, never "the latest job". */
export type FeatureJobLink = {
  imageUrl: string | null;
  message: string | null;
  conversationId: string | null;
  postId: string | null;
};

/** A feature job row: the server's snake_case fields (so it feeds `featureJobOffer`) plus its link. */
export type FeatureJob = {
  id: string;
  kind: FeatureJobKind;
  client_request_id: string;
  status: "running" | "succeeded" | "failed";
  credit_state: "none" | "charged" | "refunded";
  result: Json | null;
  error_code: string | null;
  deadline_at: string;
  created_at: string;
  completed_at: string | null;
  link: FeatureJobLink;
};

export type FeatureJobState =
  { status: "unavailable" } | { status: "ready"; job: FeatureJob | null };

const STATUSES: ReadonlySet<string> = new Set(["running", "succeeded", "failed"]);
const CREDIT_STATES: ReadonlySet<string> = new Set(["none", "charged", "refunded"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isFeatureKind(value: unknown): value is FeatureJobKind {
  return FEATURE_JOB_KINDS.includes(value as FeatureJobKind);
}

/** A row as PostgREST returns it, checked; null for another kind or anything unexpected. */
export function parseFeatureJobRow(raw: unknown): FeatureJob | null {
  const row = record(raw);
  if (!row) return null;
  const id = text(row.id);
  const clientRequestId = text(row.client_request_id);
  const deadlineAt = text(row.deadline_at);
  const createdAt = text(row.created_at);
  if (!id || !clientRequestId || !deadlineAt || !createdAt) return null;
  if (!isFeatureKind(row.kind)) return null;
  if (typeof row.status !== "string" || !STATUSES.has(row.status)) return null;
  const creditState =
    typeof row.credit_state === "string" && CREDIT_STATES.has(row.credit_state)
      ? (row.credit_state as FeatureJob["credit_state"])
      : "none";
  const input = record(row.input);
  return {
    id,
    kind: row.kind,
    client_request_id: clientRequestId,
    status: row.status as FeatureJob["status"],
    credit_state: creditState,
    result: (row.result ?? null) as Json | null,
    error_code: text(row.error_code),
    deadline_at: deadlineAt,
    created_at: createdAt,
    completed_at: text(row.completed_at),
    link: {
      imageUrl: text(input?.imageUrl),
      message: text(input?.message),
      conversationId: text(input?.conversationId),
      postId: text(input?.post_id),
    },
  };
}

// src: https://docs.postgrest.org/en/v13/references/errors.html (PGRST205: table not in the
//   schema cache) · PostgREST 13; https://www.postgresql.org/docs/current/errcodes-appendix.html
//   (42P01 undefined_table, 42703 undefined_column)
const MISSING_CODES: ReadonlySet<string> = new Set(["PGRST205", "42P01", "42703"]);

/** The generation_jobs migration is not applied in this environment. */
export function isFeatureJobsMissing(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && MISSING_CODES.has(error.code);
}

/** The page's own memory of "the table is missing": one read per 5 minutes, then it looks again. */
export const featureJobsAvailability = createAvailabilityCache();

/**
 * Her newest job of one kind, read as her within FEATURE_READ_TIMEOUT_MS.
 * A missing table answers unavailable; any other error throws, so React Query
 * keeps the last good row and retries.
 */
export async function fetchLatestFeatureJob(
  client: FeatureJobsClient,
  userId: string,
  kind: FeatureJobKind,
  authorization: string,
  timeoutMs = FEATURE_READ_TIMEOUT_MS,
): Promise<FeatureJobState> {
  // src: https://supabase.com/docs/reference/javascript/abortsignal (`.abortSignal(signal)`
  //   cancels the request) · @supabase/postgrest-js 2.110.0
  const { data, error } = await client
    .from("generation_jobs")
    .select(FEATURE_JOB_COLUMNS)
    .eq("user_id", userId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .setHeader("Authorization", authorization)
    .abortSignal(AbortSignal.timeout(timeoutMs));
  if (error) {
    if (isFeatureJobsMissing(error)) return { status: "unavailable" };
    throw error;
  }
  return { status: "ready", job: parseFeatureJobRow(data?.[0] ?? null) };
}

type StateQuery = Query<FeatureJobState, Error, FeatureJobState, readonly unknown[]>;

function jobOf(query: StateQuery): FeatureJob | null {
  const state = query.state.data;
  return state?.status === "ready" ? state.job : null;
}

/**
 * The latest-row query per kind.
 * - Idle `staleTime` 60 s, 0 while the row is running, 5 min while unavailable.
 * - Polls every 3 s while the row is running (judged against the clock when
 *   the poll decides, never one frozen at mount; an overdue row the server
 *   still sees alive, `isAlive`, counts as running), every 10 s while her own
 *   call is in flight, and never while unavailable.
 * - Refetches when she comes back to the tab.
 */
export function latestFeatureJobQueryOptions(
  userId: string | undefined,
  kind: FeatureJobKind,
  options: {
    client?: FeatureJobsClient;
    enabled?: boolean;
    inFlight?: boolean;
    isAlive?: (jobId: string) => boolean;
    availability?: AvailabilityCache;
    timeoutMs?: number;
    /** The server's time now, read when a decision is made. Defaults to the device clock. */
    now?: () => number;
  } = {},
) {
  const clock = options.now ?? Date.now;
  const client = options.client ?? supabase;
  const availability = options.availability ?? featureJobsAvailability;
  const running = (job: FeatureJob | null) =>
    !!job &&
    job.status === "running" &&
    (featureJobOffer(job, { now: clock() }) === "running" || !!options.isAlive?.(job.id));
  return queryOptions({
    queryKey: featureJobKeys.latest(userId, kind),
    queryFn: async (): Promise<FeatureJobState> => {
      if (availability.isMissing()) return { status: "unavailable" };
      const authorization = await memberAuthorization(client.auth, userId as string);
      const state = await fetchLatestFeatureJob(
        client,
        userId as string,
        kind,
        authorization,
        options.timeoutMs,
      );
      if (state.status === "unavailable") availability.markMissing();
      return state;
    },
    enabled: !!userId && (options.enabled ?? true),
    // src: https://tanstack.com/query/v5/docs/framework/react/reference/useQuery
    //   (staleTime and refetchInterval accept a function of the query) · @tanstack/react-query 5.101.2
    staleTime: (query: StateQuery) => {
      if (query.state.data?.status === "unavailable") return UNAVAILABLE_STALE_MS;
      return running(jobOf(query)) ? 0 : IDLE_STALE_MS;
    },
    refetchInterval: (query: StateQuery) => {
      if (query.state.data?.status === "unavailable") return false;
      if (running(jobOf(query))) return FEATURE_POLL_MS;
      return options.inFlight ? FEATURE_IN_FLIGHT_POLL_MS : false;
    },
    refetchOnWindowFocus: true,
    retry: memberQueryRetry,
  });
}

// ---------------------------------------------------------------------------
// Mutations and press keys
// ---------------------------------------------------------------------------

/**
 * The options every feature call's `useMutation` uses. The callbacks are
 * hook-level on purpose: TanStack Query runs them even after the page that
 * started the call has unmounted. Never retried automatically (a retry is her
 * next press, which reuses its id) and never paused offline: a charged call
 * runs now or fails now, so it is never fired later on its own.
 */
// src: https://tanstack.com/query/v5/docs/framework/react/guides/mutations ·
//   https://tanstack.com/query/v5/docs/framework/react/guides/network-mode (networkMode
//   'always' never pauses) · @tanstack/react-query 5.101.2
export function featureMutationOptions<TVariables extends { userId: string }, TData>(
  kind: FeatureJobKind,
  mutationFn: (variables: TVariables) => Promise<TData>,
  queryClient: QueryClient,
  extraKeys: ReadonlyArray<readonly unknown[]> = [],
) {
  return {
    mutationKey: featureMutationKey(kind),
    mutationFn,
    retry: false as const,
    networkMode: "always" as const,
    onSettled: (_data: TData | undefined, _error: Error | null, variables: TVariables) => {
      // A finished call may have charged or refunded a credit and moved her job row.
      void queryClient.invalidateQueries({ queryKey: queryKeys.credits(variables.userId) });
      void queryClient.invalidateQueries({ queryKey: featureJobKeys.all(variables.userId) });
      for (const queryKey of extraKeys) void queryClient.invalidateQueries({ queryKey });
    },
  };
}

/** A stable text for a request, so the same press fingerprints the same whatever its key order. */
export function featureRequestKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => featureRequestKey(v ?? null)).join(",")}]`;
  const object = record(value);
  if (object) {
    const keys = Object.keys(object)
      .filter((key) => object[key] !== undefined && object[key] !== null)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${featureRequestKey(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Idempotency keys for her presses, in memory, per member and kind. One id per
 * request fingerprint: the same press (a retry after a lost answer) reuses it,
 * so the server replays instead of charging twice. It is retired only when a
 * real server answer arrived (`retire`), never because the answer was lost.
 */
export function createFeaturePressKeys(newId: () => string = () => crypto.randomUUID()) {
  const live = new Map<string, Map<string, string>>();
  const scope = (userId: string, kind: FeatureJobKind) => `${userId}\u0000${kind}`;
  return {
    keyFor(userId: string, kind: FeatureJobKind, fingerprint: string): string {
      const key = scope(userId, kind);
      const byFingerprint = live.get(key) ?? new Map<string, string>();
      live.set(key, byFingerprint);
      const existing = byFingerprint.get(fingerprint);
      if (existing) return existing;
      const id = newId();
      byFingerprint.set(fingerprint, id);
      return id;
    },
    retire(userId: string, kind: FeatureJobKind, id: string): void {
      const byFingerprint = live.get(scope(userId, kind));
      if (!byFingerprint) return;
      for (const [fingerprint, value] of byFingerprint) {
        if (value === id) byFingerprint.delete(fingerprint);
      }
    },
  };
}
export const featurePressKeys = createFeaturePressKeys();

const LOST_CONNECTION =
  /failed to fetch|networkerror|network request failed|load failed|network connection was lost/i;

/**
 * True when the call ended without an answer from the server (a client-side
 * timeout, a dropped connection, a stale bundle): the job may still be running
 * or may have finished, so its press key is kept and the job row decides.
 */
export function isLostAnswer(error: unknown): boolean {
  if (error instanceof Error && error.name === "TimeoutError") return true;
  if (isStaleBundleError(error)) return true;
  return LOST_CONNECTION.test(errorMessage(error, ""));
}

// ---------------------------------------------------------------------------
// Dismissed ids
// ---------------------------------------------------------------------------

/** How many dismissed job ids are remembered per member. */
export const DISMISSED_LIMIT = 30;
const DISMISSED_PREFIX = "mila:feature-jobs-dismissed:";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/**
 * Jobs she dismissed, per member, in localStorage (memory when storage
 * throws). The newest 30; a member's ids are never read for another member.
 */
export function createDismissedStore(storage: () => StorageLike | null = defaultStorage) {
  const memory = new Map<string, string[]>();
  const read = (userId: string): string[] => {
    try {
      const raw = storage()?.getItem(`${DISMISSED_PREFIX}${userId}`);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const ids = parsed.filter((id): id is string => typeof id === "string");
          memory.set(userId, ids);
          return ids;
        }
      }
    } catch {
      // Unreadable or blocked storage: the memory copy speaks.
    }
    return memory.get(userId) ?? [];
  };
  return {
    get: (userId: string): string[] => read(userId),
    add(userId: string, jobId: string): string[] {
      const next = [...read(userId).filter((id) => id !== jobId), jobId].slice(-DISMISSED_LIMIT);
      memory.set(userId, next);
      try {
        storage()?.setItem(`${DISMISSED_PREFIX}${userId}`, JSON.stringify(next));
      } catch {
        // Kept in memory for this tab.
      }
      return next;
    },
  };
}

function defaultStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export const featureDismissals = createDismissedStore();

// ---------------------------------------------------------------------------
// Waiting copy
// ---------------------------------------------------------------------------

export type FeatureWait = {
  stage: string;
  /** "Analyzing your photo · you can keep browsing" */
  line: string;
};

const CONCIERGE_LEAVE_LINE = "You can leave this page. Mila's reply will be here.";

type Stage = { from: number; stage: string };

const STAGES: Record<FeatureJobKind, Stage[]> = {
  lens_analysis: [{ from: 0, stage: "Analyzing your photo" }],
  dupe_search: [
    { from: 0, stage: "Reading the piece" },
    { from: 15_000, stage: "Searching the catalog" },
    { from: 40_000, stage: "Ranking the closest pieces" },
  ],
  concierge: [{ from: 0, stage: "Mila is writing back" }],
  item_detection: [{ from: 0, stage: "Finding the pieces" }],
};

const LEAVE: Record<FeatureJobKind, string> = {
  lens_analysis: "you can keep browsing",
  dupe_search: "you can close this sheet",
  concierge: "you can leave this page",
  item_detection: "you can keep browsing",
};

/**
 * Staged wait copy. "You can leave" is said only when it is true, that is,
 * when jobs are live and the result will be kept for her.
 */
export function featureWaitCopy(
  kind: FeatureJobKind,
  elapsedMs: number,
  options: { canLeave: boolean },
): FeatureWait {
  const elapsed = Math.max(0, elapsedMs);
  const stages = STAGES[kind];
  const stage = [...stages].reverse().find((s) => elapsed >= s.from)?.stage ?? stages[0].stage;
  if (kind === "concierge" && options.canLeave) {
    // C1, verbatim (plan section 8).
    return { stage: CONCIERGE_LEAVE_LINE, line: CONCIERGE_LEAVE_LINE };
  }
  const parts = [stage];
  if (kind === "dupe_search") parts.push("about a minute");
  if (options.canLeave) parts.push(LEAVE[kind]);
  return { stage, line: parts.join(" · ") };
}

// ---------------------------------------------------------------------------
// Server clock
// ---------------------------------------------------------------------------

/** How many recent rows the server-clock estimate is taken over. */
export const FEATURE_CLOCK_SAMPLES = 5;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The server's clock as seen from this device. A row's `created_at` lands a
 * moment after the press that made it, so (created_at minus press time) is the
 * device's offset. The estimate is the median of the last 5 rows' samples, one
 * per row, so one slow upload cannot skew it. The device clock is read when
 * the time is asked for, never kept from earlier. (Logic copied from the
 * dashboard's job clock on purpose: this module imports no job module.)
 */
export function createFeatureClock(deviceNow: () => number = Date.now) {
  const samples = new Map<string, number>();
  let unnamed = 0;
  let skewMs = 0;
  return {
    /** Server time minus device time, in ms (0 until learned). */
    skew: () => skewMs,
    /** The server's time now (or for a given device time). */
    now: (device: number = deviceNow()) => device + skewMs,
    learn(serverCreatedAt: string, pressedAt: number, sampleId?: string) {
      const created = Date.parse(serverCreatedAt);
      if (!Number.isFinite(created) || !Number.isFinite(pressedAt)) return;
      const id = sampleId ?? `sample-${(unnamed += 1)}`;
      samples.delete(id);
      samples.set(id, created - pressedAt);
      while (samples.size > FEATURE_CLOCK_SAMPLES) {
        const oldest = samples.keys().next().value;
        if (oldest === undefined) break;
        samples.delete(oldest);
      }
      skewMs = median([...samples.values()]);
    },
  };
}
export type FeatureClock = ReturnType<typeof createFeatureClock>;

/**
 * Learns from her row only when the press that made it is known exactly: her
 * own request, sent once. An id sent again keeps its first press time and
 * which send made the row is unknown, so it teaches nothing.
 */
export function learnFeatureClock(
  clock: FeatureClock,
  job: Pick<FeatureJob, "id" | "client_request_id" | "created_at">,
  entry: { id: string; at: number; sends?: number } | null | undefined,
): boolean {
  if (!entry || entry.id !== job.client_request_id || entry.sends !== 1) return false;
  clock.learn(job.created_at, entry.at, job.id);
  return true;
}

/** The tab's server-clock estimate. */
export const featureClock = createFeatureClock();

type PageTarget = Pick<Window, "addEventListener" | "removeEventListener"> & {
  document?: Pick<Document, "visibilityState">;
};

/**
 * Calls `wake` whenever she comes back: the window gains focus, the tab turns
 * visible, a page is restored from the back/forward cache, or the network
 * returns. Answers the unsubscribe.
 */
export function onFeaturePageReturn(target: PageTarget | null, wake: () => void): () => void {
  if (!target) return () => {};
  const onVisible = () => {
    if (target.document?.visibilityState !== "hidden") wake();
  };
  target.addEventListener("focus", wake);
  target.addEventListener("pageshow", wake);
  target.addEventListener("online", wake);
  target.addEventListener("visibilitychange", onVisible);
  return () => {
    target.removeEventListener("focus", wake);
    target.removeEventListener("pageshow", wake);
    target.removeEventListener("online", wake);
    target.removeEventListener("visibilitychange", onVisible);
  };
}

// ---------------------------------------------------------------------------
// Reaping
// ---------------------------------------------------------------------------

/** The same job is reaped at most this often. */
export const REAP_MIN_GAP_MS = 30_000;
/** One job is reaped at most this many times (the nightly cron takes over after that). */
export const REAP_JOB_LIMIT = 3;
/** A tab reaps at most this many times in all: a runaway guard, not a budget. */
export const REAP_TAB_LIMIT = 12;
/** Kept for callers of the earlier name: it is the tab ceiling. */
export const REAP_SESSION_LIMIT = REAP_TAB_LIMIT;
/** A reap that found nothing means the server still sees the job alive, for this long. */
export const REAP_ALIVE_MS = 60_000;

export type ReapAnswer = { available: boolean; reaped: number };

/** What the tab remembers about reaping: per job gap and count, the tab total and "still alive" marks. */
export function createReapGate(now: () => number = Date.now) {
  const lastAt = new Map<string, number>();
  const perJob = new Map<string, number>();
  const aliveUntil = new Map<string, number>();
  let taken = 0;
  return {
    /** Claims a reap for this job now, or says no (too soon, or the session is used up). */
    tryTake(jobId: string): boolean {
      const at = now();
      const last = lastAt.get(jobId);
      if (last !== undefined && at - last < REAP_MIN_GAP_MS) return false;
      if ((perJob.get(jobId) ?? 0) >= REAP_JOB_LIMIT) return false;
      if (taken >= REAP_TAB_LIMIT) return false;
      taken += 1;
      perJob.set(jobId, (perJob.get(jobId) ?? 0) + 1);
      lastAt.set(jobId, at);
      return true;
    },
    markAlive(jobId: string): void {
      aliveUntil.set(jobId, now() + REAP_ALIVE_MS);
    },
    isAlive(jobId: string): boolean {
      const until = aliveUntil.get(jobId);
      return until !== undefined && now() < until;
    },
  };
}
export type ReapGate = ReturnType<typeof createReapGate>;

/** The tab's reap memory, shared by every mount. */
export const featureReapGate = createReapGate();

/**
 * Reaps a stale job through `reap` (`reapMyGenerationJobs`) if the gate
 * allows it. Answers the server's answer, or null when it was refused or the
 * call failed (a failed call still counts against the gate, so a flapping
 * connection never becomes a loop). A reap that found nothing marks the job
 * alive for 60 s.
 */
export async function reapOnce(
  jobId: string,
  reap: () => Promise<ReapAnswer>,
  gate: ReapGate = featureReapGate,
): Promise<ReapAnswer | null> {
  if (!gate.tryTake(jobId)) return null;
  try {
    const answer = await reap();
    if (answer.available && answer.reaped === 0) gate.markAlive(jobId);
    return answer;
  } catch {
    return null;
  }
}
