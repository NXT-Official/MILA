import {
  onlineManager,
  queryOptions,
  type Mutation,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { queryKeys } from "@/constants/query-keys";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { DailyLook } from "@/lib/generate-outfit.functions";
import { isMemberSessionUnavailable, memberAuthorization } from "@/lib/auth-session";
import { memberQueryRetry } from "@/lib/queries/member-query";
import { errorMessage, isStaleBundleError } from "@/lib/utils";

/**
 * The web side of generation jobs (R7): a paid look, style sheet or portrait
 * can no longer be lost by leaving the page.
 *
 * The server records every generation as a row in `public.generation_jobs`
 * (migration 20261007143000_generation_jobs.sql, RLS: she can SELECT her own
 * rows, nobody else's) and stores rendered images in the private
 * `generations` bucket at `<her id>/<job id>.<ext>`. This module reads her
 * latest row per kind, decides what a row means for the dashboard, signs her
 * images, and keeps the idempotency key (`clientRequestId`) each press sends.
 *
 * Until that migration is applied the table is missing (PGRST205 / 42P01, or
 * 42703 for a missing column): every read answers `{ status: "unavailable" }`
 * and the dashboard keeps its pre-jobs behaviour.
 */

export type GenerationJobsClient = SupabaseClient<Database>;

export const CLIENT_GENERATION_KINDS = ["look", "style_sheet", "photo_preview"] as const;
export type ClientGenerationKind = (typeof CLIENT_GENERATION_KINDS)[number];

/** How often a running job's row is re-read. */
export const GENERATION_POLL_MS = 3_000;
/** `reap_generation_jobs` fails a running job only this long after its deadline. */
export const REAP_GRACE_MS = 30_000;
/**
 * The server delivered the result to the request that asked and kept the
 * charge, but could not store it (P2a ruling, N7). It is NOT a failure and is
 * never refunded.
 */
export const PERSIST_FAILED_DELIVERED = "persist_failed_delivered";

export const GENERATIONS_BUCKET = "generations";
/** Signed image links are short-lived: the image is read once, right away. */
export const SIGNED_URL_SECONDS = 600;

export const generationJobKeys = {
  all: (userId: string | undefined) => ["generation-jobs", userId] as const,
  latest: (userId: string | undefined, kind: ClientGenerationKind) =>
    ["generation-jobs", userId, kind] as const,
  /** Her rows for these request ids (her unanswered presses), in any order. */
  own: (userId: string | undefined, kind: ClientGenerationKind, requestIds: readonly string[]) =>
    ["generation-jobs", userId, "own", kind, [...requestIds].sort().join(",")] as const,
  image: (userId: string | undefined, jobId: string | undefined) =>
    ["generation-image", userId, jobId] as const,
};

/** One mutation key per kind, so a call in flight is found again after the page remounts. */
export function generationMutationKey(kind: ClientGenerationKind) {
  return ["generation", kind] as const;
}

/** What every generation call carries: whose it is and the press's idempotency key. */
export type GenerationVariables = { userId: string; clientRequestId: string };

/**
 * The options every generation `useMutation` uses. The callbacks are
 * hook-level on purpose: TanStack Query runs them even after the page that
 * started the call has unmounted (callbacks passed to `mutate()` do not).
 * Never retried automatically: a retry is her next press, which reuses the id.
 * Never paused offline either (NEW-M1): a call runs now or fails now, so a
 * press is never fired minutes later, after she has moved on, without her
 * pressing again.
 */
// src: https://tanstack.com/query/v5/docs/framework/react/guides/mutations ("those additional
//   callbacks won't run if your component unmounts before the mutation finishes"; mutations do
//   not retry by default) · @tanstack/react-query 5.101.2
// src: https://tanstack.com/query/v5/docs/framework/react/guides/network-mode (networkMode
//   'online', the default, pauses while offline and continues once the network is back;
//   'always' ignores the online state and never pauses) · @tanstack/react-query 5.101.2
export function generationMutationOptions<TVariables extends GenerationVariables, TData>(
  kind: ClientGenerationKind,
  mutationFn: (variables: TVariables) => Promise<TData>,
  queryClient: QueryClient,
) {
  return {
    mutationKey: generationMutationKey(kind),
    mutationFn,
    retry: false as const,
    networkMode: "always" as const,
    onSettled: (_data: TData | undefined, _error: Error | null, variables: TVariables) => {
      // A finished call may have charged or refunded a credit and moved her job row.
      void queryClient.invalidateQueries({ queryKey: queryKeys.credits(variables.userId) });
      void queryClient.invalidateQueries({ queryKey: generationJobKeys.all(variables.userId) });
    },
  };
}

/** Mutation-cache filters for this kind's calls still in flight (any mount of the page). */
export function pendingGenerationFilters(kind: ClientGenerationKind) {
  return { mutationKey: generationMutationKey(kind), status: "pending" as const };
}

/** What the page needs from one pending call: its variables and when it was sent. */
// src: https://tanstack.com/query/v5/docs/framework/react/reference/useMutationState
//   (filters + select over every mutation in the MutationCache) · @tanstack/react-query 5.101.2
export function pendingGenerationOf<TVariables>(mutation: Mutation<unknown, Error, unknown>): {
  variables: TVariables | undefined;
  submittedAt: number;
} {
  return {
    variables: mutation.state.variables as TVariables | undefined,
    submittedAt: mutation.state.submittedAt,
  };
}

export type MemberGenerationJob = {
  id: string;
  kind: ClientGenerationKind;
  clientRequestId: string;
  status: "running" | "succeeded" | "failed";
  creditState: "none" | "charged" | "refunded";
  result: Json | null;
  imagePath: string | null;
  errorCode: string | null;
  /** For a style sheet or portrait: the look it was drawn for. */
  forLook: { headline: string; description: string } | null;
  /** For a look: the vibe and weather it was asked for (what it is saved under). */
  lookInput: { vibe: string | null; weather: string | null } | null;
  deadlineAt: string;
  createdAt: string;
  completedAt: string | null;
};

export type GenerationJobState =
  { status: "unavailable" } | { status: "ready"; job: MemberGenerationJob | null };

type ErrorLike = { code?: string | null; message?: string } | null | undefined;

// src: https://docs.postgrest.org/en/v13/references/errors.html (PGRST205: table not in the
//   schema cache) · PostgREST 13; https://www.postgresql.org/docs/current/errcodes-appendix.html
//   (42P01 undefined_table, 42703 undefined_column)
const MISSING_CODES = new Set(["PGRST205", "42P01", "42703"]);

/** The generation_jobs migration is not applied in this environment. */
export function isGenerationJobsMissing(error: ErrorLike): boolean {
  return !!error?.code && MISSING_CODES.has(error.code);
}

const JOB_COLUMNS =
  "id,kind,client_request_id,status,credit_state,result,image_path,error_code,input,deadline_at,created_at,completed_at";

const STATUSES = new Set(["running", "succeeded", "failed"]);
const CREDIT_STATES = new Set(["none", "charged", "refunded"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The look a sheet or portrait row was drawn for: `input.outfit.outfit`. */
function lookOfInput(input: unknown): MemberGenerationJob["forLook"] {
  const outfit = record(record(record(input)?.outfit)?.outfit);
  const headline = text(outfit?.headline);
  const description = text(outfit?.description);
  return headline && description ? { headline, description } : null;
}

/** A row as PostgREST returns it, checked; null for anything unexpected. */
export function parseGenerationJobRow(raw: unknown): MemberGenerationJob | null {
  const row = record(raw);
  if (!row) return null;
  const id = text(row.id);
  const kind = row.kind;
  const status = row.status;
  const clientRequestId = text(row.client_request_id);
  const deadlineAt = text(row.deadline_at);
  const createdAt = text(row.created_at);
  if (!id || !clientRequestId || !deadlineAt || !createdAt) return null;
  if (!CLIENT_GENERATION_KINDS.includes(kind as ClientGenerationKind)) return null;
  if (typeof status !== "string" || !STATUSES.has(status)) return null;
  const creditState = CREDIT_STATES.has(row.credit_state as string)
    ? (row.credit_state as MemberGenerationJob["creditState"])
    : "none";
  return {
    id,
    kind: kind as ClientGenerationKind,
    clientRequestId,
    status: status as MemberGenerationJob["status"],
    creditState,
    result: (row.result ?? null) as Json | null,
    imagePath: text(row.image_path),
    errorCode: text(row.error_code),
    forLook: kind === "look" ? null : lookOfInput(row.input),
    lookInput:
      kind === "look"
        ? { vibe: text(record(row.input)?.vibe), weather: text(record(row.input)?.weather) }
        : null,
    deadlineAt,
    createdAt,
    completedAt: text(row.completed_at),
  };
}

/**
 * Her newest row of one kind. Sent with her own `Authorization` header (see
 * `memberAuthorization`), so it can never run as anonymous and read "no job".
 */
export async function fetchLatestGenerationJob(
  client: GenerationJobsClient,
  userId: string,
  kind: ClientGenerationKind,
  authorization: string,
  options: { signal?: AbortSignal } = {},
): Promise<GenerationJobState> {
  let request = client
    .from("generation_jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .setHeader("Authorization", authorization);
  // src: https://supabase.com/docs/reference/javascript/abortsignal (`.abortSignal(signal)`
  //   cancels the request; `AbortController` + `setTimeout` is the documented timeout) ·
  //   supabase-js 2.110.0
  if (options.signal) request = request.abortSignal(options.signal);
  const { data, error } = await request;
  if (error) {
    if (isGenerationJobsMissing(error)) return { status: "unavailable" };
    // Anything else (a refused read while she reconnects, a 5xx) throws, so
    // React Query keeps the last good row on screen and retries.
    throw error;
  }
  return { status: "ready", job: parseGenerationJobRow(data?.[0] ?? null) };
}

/** Her rows for a set of request ids, newest first; `unavailable` while the table is missing. */
export type OwnJobsState =
  { status: "unavailable" } | { status: "ready"; jobs: MemberGenerationJob[] };

/** At most this many of her unanswered ids are asked about at once (the newest). */
const MAX_OWN_IDS = 20;

/**
 * Her own rows for these request ids (round 3): the jobs of her unanswered
 * presses, read directly, so her own job is found even when another device's
 * newer job is the latest row. RLS shows her only her own rows; the
 * `user_id` filter and her explicit `Authorization` header say the same.
 */
// src: https://supabase.com/docs/reference/javascript/in (`.in(column, values)`) · supabase-js
//   2.110.0; https://docs.postgrest.org/en/v12/references/api/tables_views.html (`in.(a,b)`)
export async function fetchGenerationJobsByRequestIds(
  client: GenerationJobsClient,
  userId: string,
  kind: ClientGenerationKind,
  requestIds: readonly string[],
  authorization: string,
  options: { signal?: AbortSignal } = {},
): Promise<OwnJobsState> {
  const ids = requestIds.slice(-MAX_OWN_IDS);
  let request = client
    .from("generation_jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .eq("kind", kind)
    .in("client_request_id", ids)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, ids.length))
    .setHeader("Authorization", authorization);
  if (options.signal) request = request.abortSignal(options.signal);
  const { data, error } = await request;
  if (error) {
    if (isGenerationJobsMissing(error)) return { status: "unavailable" };
    throw error;
  }
  const jobs = (data ?? [])
    .map((row) => parseGenerationJobRow(row))
    .filter((job): job is MemberGenerationJob => job !== null);
  return { status: "ready", jobs };
}

/** While the table is missing, it is asked again at most this often (like the server). */
export const UNAVAILABLE_RECHECK_MS = 5 * 60 * 1000;

/**
 * "The generation_jobs migration is not applied here", remembered for the
 * page session so a missing table costs one read every 5 minutes instead of
 * three on every mount and every focus (M1). Mirrors the server's
 * availability cache (src/lib/availability-cache.ts, re-probed after 5 min).
 */
export function createJobsAvailability(options: { now?: () => number; recheckMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const recheckMs = options.recheckMs ?? UNAVAILABLE_RECHECK_MS;
  let missingUntil = 0;
  return {
    isMissing: () => now() < missingUntil,
    markMissing: () => {
      missingUntil = now() + recheckMs;
    },
    markPresent: () => {
      missingUntil = 0;
    },
  };
}
export type JobsAvailability = ReturnType<typeof createJobsAvailability>;

/** The page's own availability memory. */
export const generationJobsAvailability = createJobsAvailability();

/** How many recent rows the server-clock estimate is taken over (NEW-M2). */
export const CLOCK_SAMPLES = 5;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The server's clock as seen from this device (M3). Phase, recency and "is
 * this newer than her last press" compare server timestamps, so the device's
 * offset from the server is learned from her own job rows: a row's
 * `created_at` lands a moment after the press that started it.
 * - The device clock is read when the time is asked for (`now()`), never
 *   kept from earlier (NEW-I1).
 * - The offset is the median of the last few rows' samples, one per row, so
 *   one request that sat in a slow upload cannot skew it (NEW-M2).
 */
export function createServerClock(options: { deviceNow?: () => number } = {}) {
  const deviceClock = options.deviceNow ?? Date.now;
  const samples = new Map<string, number>();
  let unnamed = 0;
  let skewMs = 0;
  return {
    /** Server time minus device time, in ms (0 until learned). */
    skew: () => skewMs,
    /** The server's time now (or for a given device time). */
    now: (deviceNow: number = deviceClock()) => deviceNow + skewMs,
    /**
     * Learn the offset from her own row created by a press sent at `pressedAt`
     * (device). `sampleId` (the row's id) keeps a row read again from counting twice.
     */
    learn: (serverCreatedAt: string, pressedAt: number, sampleId?: string) => {
      const created = Date.parse(serverCreatedAt);
      if (!Number.isFinite(created) || !Number.isFinite(pressedAt)) return;
      const id = sampleId ?? `sample-${(unnamed += 1)}`;
      samples.delete(id);
      samples.set(id, created - pressedAt);
      while (samples.size > CLOCK_SAMPLES) {
        const oldest = samples.keys().next().value;
        if (oldest === undefined) break;
        samples.delete(oldest);
      }
      skewMs = median([...samples.values()]);
    },
  };
}
export type ServerClock = ReturnType<typeof createServerClock>;

/**
 * Learns the server's clock from her row only when the press that made it is
 * known exactly (NEW-M2): her own request, sent once. An id sent again (a
 * re-press after a lost answer, or a changed press sent under it) keeps its
 * first press time, and which send made the row is unknown, so it teaches
 * nothing. An entry without a send count (kept before counts were) is not
 * trusted either.
 */
export function learnServerClock(
  clock: ServerClock,
  job: MemberGenerationJob,
  entry: GenerationRequestEntry | null | undefined,
): boolean {
  if (!entry || entry.id !== job.clientRequestId || entry.sends !== 1) return false;
  clock.learn(job.createdAt, entry.at, job.id);
  return true;
}

/** The page's own server-clock estimate. */
export const generationClock = createServerClock();

/** While her own call is in flight its answer carries the result: the row is read slowly. */
export const IN_FLIGHT_POLL_MS = 10_000;

/**
 * The latest-row query per kind.
 * - Polls every 3 s while the row is genuinely running (by the server's clock,
 *   `serverNow`; a row past its deadline + grace is dead and is not polled
 *   unless the server said it is still alive, `isAlive`).
 * - Polls every 10 s while this page waits on its own call (`inFlight`).
 * - Refetches when she comes back to the tab (the browser pauses the poll
 *   while the tab is hidden).
 * - A missing table is remembered for 5 minutes: no reads, no focus refetch.
 */
export function latestGenerationJobQueryOptions(
  userId: string | undefined,
  kind: ClientGenerationKind,
  options: {
    client?: GenerationJobsClient;
    inFlight?: boolean;
    enabled?: boolean;
    serverNow?: () => number;
    isAlive?: (jobId: string) => boolean;
    availability?: JobsAvailability;
  } = {},
) {
  const client = options.client ?? supabase;
  const availability = options.availability ?? generationJobsAvailability;
  const serverNow = options.serverNow ?? (() => Date.now());
  return queryOptions({
    queryKey: generationJobKeys.latest(userId, kind),
    queryFn: async (): Promise<GenerationJobState> => {
      if (availability.isMissing()) return { status: "unavailable" };
      const authorization = await memberAuthorization(client.auth, userId as string);
      const state = await fetchLatestGenerationJob(client, userId as string, kind, authorization);
      if (state.status === "unavailable") availability.markMissing();
      else availability.markPresent();
      return state;
    },
    enabled: !!userId && (options.enabled ?? true),
    // src: https://tanstack.com/query/v5/docs/framework/react/reference/useQuery
    //   (staleTime: number | 'static' | ((query) => number | 'static');
    //   refetchInterval: number | false | ((query) => number | false | undefined);
    //   refetchOnWindowFocus default true, refetches only stale data) · @tanstack/react-query 5.101.2
    staleTime: (query: Query<GenerationJobState, Error, GenerationJobState, readonly unknown[]>) =>
      query.state.data?.status === "unavailable" ? UNAVAILABLE_RECHECK_MS : 0,
    refetchInterval: (
      query: Query<GenerationJobState, Error, GenerationJobState, readonly unknown[]>,
    ) => {
      const state = query.state.data;
      if (state?.status === "unavailable") return false;
      const job = state?.status === "ready" ? state.job : null;
      if (job?.status === "running") {
        const phase = generationJobPhase(job, serverNow());
        if (phase === "running" || options.isAlive?.(job.id)) return GENERATION_POLL_MS;
      }
      return options.inFlight ? IN_FLIGHT_POLL_MS : false;
    },
    refetchOnWindowFocus: true,
    retry: memberQueryRetry,
  });
}

/**
 * How long after a press its job's row can still appear (round 4). The server
 * records the row the moment the request arrives, and the page stops waiting
 * for an answer after LOOK_TIMEOUT_MS (240 s): a row that has not appeared by
 * then belongs to a request that never arrived.
 */
export const OWN_ROW_WAIT_MS = 5 * 60 * 1000;

/**
 * Until when (device clock) a row for one of these unanswered presses can
 * still appear: OWN_ROW_WAIT_MS after her newest send (round 5: a resend
 * counts, `lastAt`).
 */
export function ownRowsExpectedUntil(entries: readonly GenerationRequestEntry[]): number {
  if (entries.length === 0) return 0;
  return Math.max(...entries.map((entry) => entry.lastAt ?? entry.at)) + OWN_ROW_WAIT_MS;
}

/**
 * The page's read of her unanswered presses' rows (round 3), alongside the
 * latest-row query: only when she has unanswered ids (`enabled`), each read
 * bounded by JOB_CHECK_TIMEOUT_MS (no answer in time is a failure, so the
 * query keeps her last rows and retries). Refetches when she comes back to
 * the tab, and polls:
 * - every 3 s while one of those jobs is still being made;
 * - every 10 s while one of those ids has no row yet and its row can still
 *   appear (`rowExpectedUntil`, device clock; round 4). A return to the tab is
 *   not enough on its own: TanStack merges it into a read already in flight,
 *   and that read may have been answered before her row existed.
 */
export function ownGenerationJobsQueryOptions(
  userId: string | undefined,
  kind: ClientGenerationKind,
  requestIds: readonly string[],
  options: {
    client?: GenerationJobsClient;
    enabled?: boolean;
    serverNow?: () => number;
    isAlive?: (jobId: string) => boolean;
    availability?: JobsAvailability;
    timeoutMs?: number;
    rowExpectedUntil?: number;
    awaitRowPollMs?: number;
    deviceNow?: () => number;
  } = {},
) {
  const serverNow = options.serverNow ?? (() => Date.now());
  const deviceNow = options.deviceNow ?? (() => Date.now());
  return queryOptions({
    queryKey: generationJobKeys.own(userId, kind, requestIds),
    queryFn: async (): Promise<OwnJobsState> => {
      const read = await readOwnJobsWithin(userId as string, kind, requestIds, options);
      if (read.status === "read") return read.state;
      throw new Error(
        read.status === "timed_out"
          ? "Her requests could not be read in time."
          : "Her requests could not be read.",
      );
    },
    enabled: !!userId && requestIds.length > 0 && (options.enabled ?? true),
    staleTime: (query: Query<OwnJobsState, Error, OwnJobsState, readonly unknown[]>) =>
      query.state.data?.status === "unavailable" ? UNAVAILABLE_RECHECK_MS : 0,
    refetchInterval: (query: Query<OwnJobsState, Error, OwnJobsState, readonly unknown[]>) => {
      const state = query.state.data;
      if (state?.status === "unavailable") return false;
      const jobs = state?.status === "ready" ? state.jobs : [];
      if (jobs.some((job) => isJobInProgress(job, serverNow(), options.isAlive))) {
        return GENERATION_POLL_MS;
      }
      const found = new Set(jobs.map((job) => job.clientRequestId));
      const missing = requestIds.some((id) => !found.has(id));
      return missing && deviceNow() < (options.rowExpectedUntil ?? 0)
        ? (options.awaitRowPollMs ?? IN_FLIGHT_POLL_MS)
        : false;
    },
    refetchOnWindowFocus: true,
    retry: memberQueryRetry,
  });
}

/**
 * Whether another look must still wait for hers (the `ownPending` hold):
 * - held while one of her jobs is still being made, or has finished with a
 *   look that can land;
 * - held while her ids could not be read (not yet, or the read failed), or
 *   one of her rows has not appeared yet, until OWN_ROW_WAIT_MS after her
 *   newest press (`rowExpectedUntil`, device clock; round 5, N-1): her press
 *   may still be running, and a look from another device landing first would
 *   keep hers from landing at all;
 * - lifted at once when every one of her ids has been read and none is (it
 *   failed, or its look cannot be shown), and once a missing row can no longer
 *   appear (the press never arrived). The hold is bounded, never 10 minutes.
 */
export function ownPressesHold(input: {
  state: OwnJobsState | undefined;
  requestIds: readonly string[];
  rowExpectedUntil: number;
  deviceNow?: number;
  now: number;
  isAlive?: (jobId: string) => boolean;
}): boolean {
  const { state, requestIds, rowExpectedUntil, now, isAlive } = input;
  const rowsMayAppear = (input.deviceNow ?? Date.now()) < rowExpectedUntil;
  if (state === undefined) return rowsMayAppear;
  if (state.status !== "ready") return false;
  const live = state.jobs.some(
    (job) =>
      isJobInProgress(job, now, isAlive) ||
      (job.status === "succeeded" && !!storedLookFromJob(job)),
  );
  if (live) return true;
  const found = new Set(state.jobs.map((job) => job.clientRequestId));
  return rowsMayAppear && requestIds.some((id) => !found.has(id));
}

/**
 * Her own job that is not the latest row (another device's newer job is),
 * the newest of them, or null (round 3). The caller passes only rows of her
 * unanswered requests.
 */
export function ownJobBehindLatest(
  ownJobs: readonly MemberGenerationJob[],
  latest: MemberGenerationJob | null | undefined,
): MemberGenerationJob | null {
  const behind = ownJobs.filter((job) => job.id !== latest?.id);
  if (behind.length === 0) return null;
  return [...behind].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

export type GenerationJobPhase = "running" | "stale" | "succeeded" | "delivered" | "failed";

/**
 * What a row means for her:
 * - running: still being made;
 * - stale: still "running" 30 s past its deadline, so its server was ended
 *   mid-generation (the reaper will fail and refund it);
 * - delivered: `persist_failed_delivered`, handed to the request that asked
 *   and charged, never a failure and never refunded (N7);
 * - succeeded / failed.
 */
export function generationJobPhase(job: MemberGenerationJob, now: number): GenerationJobPhase {
  if (job.status === "running") {
    const deadline = Date.parse(job.deadlineAt);
    return Number.isFinite(deadline) && now > deadline + REAP_GRACE_MS ? "stale" : "running";
  }
  if (job.status === "succeeded") return "succeeded";
  return job.errorCode === PERSIST_FAILED_DELIVERED ? "delivered" : "failed";
}

/**
 * The same job was running and now is not: the moment a refund or charge may
 * have landed, so her balance is refreshed.
 */
export function jobJustSettled(
  before: MemberGenerationJob | null | undefined,
  after: MemberGenerationJob | null | undefined,
): boolean {
  return (
    !!before &&
    !!after &&
    before.id === after.id &&
    before.status === "running" &&
    after.status !== "running"
  );
}

const KIND_NOUN: Record<ClientGenerationKind, string> = {
  look: "look",
  style_sheet: "style sheet",
  photo_preview: "portrait",
};

/**
 * What to tell her when HER OWN job (one this tab asked for and never heard
 * back from) turns out to have failed. Null when there is nothing to report:
 * still running, succeeded, or delivered-but-unsaved (charged and handed to
 * the request that asked: never a failure, never a refund, N7). A refund is
 * mentioned only when the row says one was made.
 */
export function generationFailureNotice(job: MemberGenerationJob): string | null {
  if (job.status !== "failed" || job.errorCode === PERSIST_FAILED_DELIVERED) return null;
  const noun = KIND_NOUN[job.kind];
  return job.creditState === "refunded"
    ? `Mila couldn't finish your ${noun}. Your credit is back.`
    : `Mila couldn't finish your ${noun}. Please try again.`;
}

/**
 * A row that is genuinely still being made: running by the server's clock
 * (`now`), or past its deadline by that clock but confirmed alive by the
 * server's own reaper (`isAlive`: the reap found nothing to reap, M3).
 */
export function isJobInProgress(
  job: MemberGenerationJob | null | undefined,
  now: number,
  isAlive?: (jobId: string) => boolean,
): boolean {
  if (!job) return false;
  const phase = generationJobPhase(job, now);
  return phase === "running" || (phase === "stale" && !!isAlive?.(job.id));
}

type LookLike = { outfit: { headline: string; description: string } };

/** Whether a sheet or portrait row was drawn for this look. */
export function jobIsForLook(
  job: MemberGenerationJob | null | undefined,
  look: LookLike | null | undefined,
): boolean {
  if (!job?.forLook || !look) return false;
  return (
    job.forLook.headline === look.outfit.headline &&
    job.forLook.description === look.outfit.description
  );
}

function isTextField(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A stored look result, checked against the shape the dashboard renders. */
export function storedLookFromJob(job: MemberGenerationJob): DailyLook | null {
  const look = record(job.result);
  const outfit = record(look?.outfit);
  const hair = record(look?.hair);
  if (!look || !outfit || !hair) return null;
  if (![outfit.headline, outfit.description, outfit.styling_notes].every(isTextField)) return null;
  if (![hair.style, hair.execution_tip].every(isTextField)) return null;
  const score = look.vibe_alignment_score;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  const makeup = look.makeup ?? null;
  if (makeup !== null) {
    const m = record(makeup);
    if (!m || ![m.palette, m.details].every(isTextField)) return null;
  }
  if (look.shoppable_picks !== undefined && !Array.isArray(look.shoppable_picks)) return null;
  return { ...(look as unknown as DailyLook), makeup: makeup as DailyLook["makeup"] };
}

/** How far back an unasked look from before today may come back (web and mobile agree). */
export const RECOVERY_WINDOW_MS = 12 * 60 * 60 * 1000;

/** When the look finished, on the server's clock (`completed_at`, else `created_at`). */
function finishedAt(job: MemberGenerationJob): number {
  return Date.parse(job.completedAt ?? job.createdAt);
}

function sameLocalDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * Whether a finished look may come back unasked: it finished on her local
 * day, or within the last 12 hours (so 23:58 still counts at 00:02). Both
 * times are the server's (`now` is the server's clock as seen from here).
 */
export function isRecentLook(job: MemberGenerationJob, now: number): boolean {
  const at = finishedAt(job);
  if (!Number.isFinite(at)) return false;
  return sameLocalDay(at, now) || (now >= at && now - at <= RECOVERY_WINDOW_MS);
}

const LABEL_TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
// ICU puts a narrow no-break space (U+202F) or a no-break space (U+00A0)
// before AM/PM; the label uses a plain space.
const ODD_SPACES = new RegExp(`[${String.fromCharCode(0x202f, 0x00a0)}]`, "g");

/**
 * A small label for a look that comes back from before today, so a look from
 * last night is not read as this morning's: "From last night, 11:40 PM" or
 * "From yesterday, 5:05 PM". Null for a look from today.
 */
export function recoveredLookLabel(job: MemberGenerationJob, now: number): string | null {
  const at = finishedAt(job);
  if (!Number.isFinite(at) || sameLocalDay(at, now)) return null;
  const time = LABEL_TIME.format(new Date(at)).replace(ODD_SPACES, " ");
  const hour = new Date(at).getHours();
  const yesterday = sameLocalDay(at, now - 86_400_000);
  if (yesterday && hour >= 18) return `From last night, ${time}`;
  if (yesterday) return `From yesterday, ${time}`;
  return `From ${new Date(at).toLocaleDateString("en-US", { weekday: "long" })}, ${time}`;
}

/**
 * What a recovered look carries: the vibe and weather it was asked for (what
 * it is saved under), and a label when it is from before today.
 */
export type RecoveredLookContext = {
  vibe: string | null;
  weatherLabel: string | null;
  fromLabel: string | null;
};

/**
 * The look row's weather as the save path writes it: the request sends
 * "24°C Sunny (in Manila)", a saved look reads "24°C Sunny (Manila)".
 */
function weatherLabelOf(weather: string | null): string | null {
  if (!weather) return null;
  const match = /^(.*) \(in (.*)\)$/.exec(weather);
  return match ? `${match[1]} (${match[2]})` : weather;
}

/**
 * What a look answered under a reused id was asked for (round 3): a changed
 * press sent under her unanswered id may be answered with THAT id's job (a
 * replay), so the look is shown and saved with that job's vibe and weather,
 * never the new press's.
 * - Her job row's input, when it is this request's row and carries them;
 * - else what the id's first press asked for, kept with it in the ledger;
 * - else `fallback` (this press's own).
 */
export function askedForLook(
  job: MemberGenerationJob | null | undefined,
  entry: GenerationRequestEntry | null | undefined,
  fallback: { vibe: string | null; weatherLabel: string | null },
): { vibe: string | null; weatherLabel: string | null } {
  const input = job && (!entry || job.clientRequestId === entry.id) ? job.lookInput : null;
  if (input && (input.vibe || input.weather)) {
    return { vibe: input.vibe, weatherLabel: weatherLabelOf(input.weather) };
  }
  const asked = entry?.asked;
  if (asked && (asked.vibe || asked.weather)) {
    return { vibe: asked.vibe ?? null, weatherLabel: weatherLabelOf(asked.weather ?? null) };
  }
  return fallback;
}

/** A job the page already holds (any cached latest-row or own-ids state), by its id. */
export function findCachedJob(
  states: ReadonlyArray<unknown>,
  jobId: string,
): MemberGenerationJob | null {
  for (const state of states) {
    const value = record(state);
    if (value?.status !== "ready") continue;
    const jobs = Array.isArray(value.jobs) ? value.jobs : [value.job];
    for (const job of jobs) {
      const known = record(job);
      if (known?.id === jobId) return job as MemberGenerationJob;
    }
  }
  return null;
}

type Asked = { vibe: string | null; weatherLabel: string | null };

/**
 * What a look just answered was asked for, settled from the answer itself
 * the moment it arrives (round 4, R3-1):
 * - the answer's job (its `jobId`) is one the page already holds: that job's
 *   own input (a replay, or another running job's look returned to this press);
 * - sent under this request's own id: this press's own (the same id means the
 *   same request, and the server only lends a running job's look to an
 *   identical one);
 * - sent under a borrowed id (`sentAs`) and not held: what the id's first press
 *   asked for, not yet confirmed (the job may instead have been started by
 *   this press, if the first never arrived); `confirmLookAsked` settles it.
 */
export function answerAsked(input: {
  cachedJob: MemberGenerationJob | null;
  sentAs: string | null;
  entry: GenerationRequestEntry | null | undefined;
  pressAsked: Asked;
  /**
   * The server's own word (round 5): false when this call started the job,
   * so this press's request is the job's input; true for a stored job.
   */
  replayed?: boolean;
}): { asked: Asked; confirmed: boolean } {
  const { cachedJob, sentAs, entry, pressAsked, replayed } = input;
  const fromJob = cachedJob?.lookInput;
  if (fromJob && (fromJob.vibe || fromJob.weather)) {
    return {
      asked: { vibe: fromJob.vibe, weatherLabel: weatherLabelOf(fromJob.weather) },
      confirmed: true,
    };
  }
  if (!sentAs || replayed === false) return { asked: pressAsked, confirmed: true };
  return { asked: askedForLook(null, entry, pressAsked), confirmed: false };
}

/**
 * Settles what a look answered under a borrowed id was asked for, from its
 * job row (read within the check's time limit): the row says which press
 * made the job. When the row cannot be read (or is not found) it is NOT
 * confirmed (round 5, N-3): `fallback` comes back for display only, and a
 * save refuses rather than store it.
 */
export async function confirmLookAsked(
  userId: string,
  input: {
    requestId: string;
    jobId: string | null;
    entry: GenerationRequestEntry | null | undefined;
    fallback: Asked;
    client?: GenerationJobsClient;
    availability?: JobsAvailability;
    timeoutMs?: number;
  },
): Promise<{ asked: Asked; confirmed: boolean }> {
  const unconfirmed = { asked: input.fallback, confirmed: false };
  const read = await readOwnJobsWithin(userId, "look", [input.requestId], input);
  if (read.status !== "read" || read.state.status !== "ready") return unconfirmed;
  const row =
    read.state.jobs.find((job) =>
      input.jobId ? job.id === input.jobId : job.clientRequestId === input.requestId,
    ) ?? null;
  if (!row) return unconfirmed;
  return {
    asked: askedForLook(row, { id: row.clientRequestId, key: "", at: 0 }, input.fallback),
    confirmed: true,
  };
}

/**
 * The look as it is saved (round 5, N-3): one whose vibe and weather are
 * still a guess is confirmed first (`confirm`); null when it cannot be, so
 * the page refuses the save. A guess is never saved.
 */
export async function settleLookForSave<
  T extends { askedConfirmed?: boolean; vibe?: string | null; weatherLabel?: string | null },
>(look: T, confirm: () => Promise<{ asked: Asked; confirmed: boolean }>): Promise<T | null> {
  if (look.askedConfirmed !== false) return look;
  const result = await confirm();
  if (!result.confirmed) return null;
  return { ...look, ...result.asked, askedConfirmed: true };
}

/**
 * Which look is on screen, known the moment the page sets it (round 5, N-2):
 * a press that awaited its check compares against this, never against a
 * value written by an effect after the next render.
 */
export function createLookMark() {
  let jobId: string | null = null;
  return {
    jobId: () => jobId,
    set: (look: { jobId?: string | null } | null) => {
      jobId = look?.jobId ?? null;
    },
  };
}

/**
 * Whether a look on screen answers this press (round 4, I-B): one that came
 * onto the screen while the check ran (her own look landing), or one from one
 * of her unanswered jobs. The press then shows it and clears nothing, so a
 * look she paid for and its style sheet are never wiped.
 */
export function lookAnswersPress(input: {
  shownBefore: string | null;
  shownNow: string | null;
  herJobIds: readonly string[];
}): boolean {
  const { shownBefore, shownNow, herJobIds } = input;
  if (!shownNow) return false;
  return shownNow !== shownBefore || herJobIds.includes(shownNow);
}

/**
 * Whether a real refusal of a press retires the id it was sent under: only
 * when that id is this request's own (round 4, M-1) and this was its only
 * send (round 5, m-3). A borrowed id, or an id sent before (a same-request
 * resend), stays: a refusal before the job ran (her session reconnecting,
 * say) says nothing about the earlier send, which may already have run.
 */
export function refusalRetires(
  entry: GenerationRequestEntry | null | undefined,
  requestKey: string,
): boolean {
  if (!entry) return true;
  return entry.key === requestKey && entry.sends === 1;
}

/**
 * The look to put back on screen after she left and came back (route change,
 * tab switch, reload, a discarded tab), or null.
 * - A look already on screen is never swapped (round 3: this is checked
 *   first, before `own`). Her own job then waits: it lands once the screen is
 *   clear (her next press clears it, and so does a reload).
 * - Her own request this tab never heard back from lands (`own`): she paid
 *   for it.
 * - A job this page showed as "composing" lands when it succeeds and nothing
 *   is on screen (`watched`), whatever she pressed meanwhile (I1).
 * - While a press of hers is unanswered (`ownPending`), no other look comes
 *   back unasked, so hers can land first (round 3).
 * - Otherwise only when nothing is on screen, it finished on her local day or
 *   within the last 12 hours (server times, `isRecentLook`), and it is newer
 *   than her last Create press here (`clearedAt`, on the server's clock).
 * - A look from before today carries a label ("From last night, 11:40 PM").
 * The caller still skips a look she has already saved (`fetchLookSaved`).
 */
export function lookToRecover(input: {
  job: MemberGenerationJob | null | undefined;
  /** The look on screen (null when none), with the job it came from. */
  shown: { jobId: string | null } | null;
  own: boolean;
  watched: boolean;
  /** She has a press of her own still unanswered (round 3). */
  ownPending?: boolean;
  /** Her last Create press, on the server's clock. */
  clearedAt: number;
  /** Now, on the server's clock. */
  now: number;
}): ({ look: DailyLook; jobId: string; own: boolean } & RecoveredLookContext) | null {
  const { job, shown, own, watched, ownPending = false, clearedAt, now } = input;
  if (!job || job.kind !== "look" || job.status !== "succeeded") return null;
  if (shown?.jobId === job.id) return null;
  // Never swap what she is looking at, whoever's job this is (round 3).
  if (shown) return null;
  const look = storedLookFromJob(job);
  if (!look) return null;
  const decision = {
    look,
    jobId: job.id,
    own,
    vibe: job.lookInput?.vibe ?? null,
    weatherLabel: weatherLabelOf(job.lookInput?.weather ?? null),
    fromLabel: recoveredLookLabel(job, now),
  };
  if (own) return decision;
  if (watched) return decision;
  if (ownPending) return null;
  const created = Date.parse(job.createdAt);
  if (!Number.isFinite(created) || created < clearedAt) return null;
  if (!isRecentLook(job, now)) return null;
  return decision;
}

/**
 * `lookToRecover`, judged at the moment it is asked (NEW-I1): the server's
 * time is read from `clock` now, never a time the page captured when it
 * opened. A tab left open overnight judges "recent" and "from before today"
 * by the time she comes back. `lastPressAt` is her last Create press here, on
 * the device's clock (0 for none); it is converted on the same server clock.
 */
export function decideLookRecovery(
  input: Omit<Parameters<typeof lookToRecover>[0], "now" | "clearedAt"> & {
    lastPressAt: number;
    clock: ServerClock;
  },
): ReturnType<typeof lookToRecover> {
  const { lastPressAt, clock, ...rest } = input;
  return lookToRecover({ ...rest, clearedAt: clock.now(lastPressAt), now: clock.now() });
}

type PageEvents = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Calls `onReturn` whenever she comes back to the page: the window gets
 * focus, the tab becomes visible, a page is restored from the back-forward
 * cache, or the device is back online. A tab left open re-reads the time then
 * (NEW-I1), whether or not anything is running. Returns the unsubscribe.
 * `visibilitychange` is fired at the document and bubbles to the window
 * (TanStack Query's focusManager listens on the window the same way).
 */
// src: https://tanstack.com/query/v5/docs/reference/focusManager (visibilitychange on window)
//   · @tanstack/react-query 5.101.2
export function onPageReturn(
  target: PageEvents | null | undefined,
  onReturn: () => void,
  isVisible: () => boolean = () =>
    typeof document === "undefined" || document.visibilityState !== "hidden",
): () => void {
  if (!target) return () => {};
  const returned = () => onReturn();
  const shown = () => {
    if (isVisible()) onReturn();
  };
  const events = ["focus", "pageshow", "online"] as const;
  for (const type of events) target.addEventListener(type, returned);
  target.addEventListener("visibilitychange", shown);
  return () => {
    for (const type of events) target.removeEventListener(type, returned);
    target.removeEventListener("visibilitychange", shown);
  };
}

/**
 * Whether she has already saved this look to her history: a daily-look row in
 * `outfits` with the same headline, saved since the job was created. A saved
 * look is never brought back (saving it again would duplicate it, M2).
 */
export async function fetchLookSaved(
  client: GenerationJobsClient,
  userId: string,
  look: LookLike,
  sinceIso: string,
  authorization: string,
): Promise<boolean> {
  // src: https://supabase.com/docs/reference/javascript/using-filters ("Filter by values
  //   within a JSON column", `.eq('address->postcode', …)`) · supabase-js 2.110.0;
  //   https://docs.postgrest.org/en/v12/references/api/tables_views.html#json-columns
  //   (`->>` compares the field as text)
  const { data, error } = await client
    .from("outfits")
    .select("id")
    .eq("user_id", userId)
    .eq("analysis_result->outfit->>headline", look.outfit.headline)
    .gte("created_at", sinceIso)
    .limit(1)
    .setHeader("Authorization", authorization);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export function lookSavedQueryOptions(
  userId: string | undefined,
  candidate: { jobId: string; look: LookLike; since: string } | null,
  options: { client?: GenerationJobsClient } = {},
) {
  const client = options.client ?? supabase;
  return queryOptions({
    queryKey: ["generation-look-saved", userId, candidate?.jobId] as const,
    queryFn: async () => {
      const authorization = await memberAuthorization(client.auth, userId as string);
      const { look, since } = candidate as NonNullable<typeof candidate>;
      return fetchLookSaved(client, userId as string, look, since, authorization);
    },
    enabled: !!userId && !!candidate,
    retry: memberQueryRetry,
  });
}

/**
 * A sheet or portrait row whose image belongs on the look on screen: only a
 * SUCCEEDED row (N2: an image left behind by a refunded job is never shown),
 * drawn for this look, while no image is shown.
 */
export function visualToRecover(
  job: MemberGenerationJob | null | undefined,
  look: LookLike | null | undefined,
  hasImage: boolean,
): MemberGenerationJob | null {
  if (!job || !look || hasImage) return null;
  if (job.status !== "succeeded" || !job.imagePath) return null;
  return jobIsForLook(job, look) ? job : null;
}

/**
 * True when this look has no style sheet attempt to report: none was started
 * for it, or one was delivered elsewhere and not kept (never a failure, N7).
 * False for a sheet that genuinely failed or succeeded for it.
 */
export function styleSheetNeverDrawn(
  job: MemberGenerationJob | null | undefined,
  look: LookLike | null | undefined,
): boolean {
  if (!look) return false;
  if (!job || !jobIsForLook(job, look)) return true;
  return job.status === "failed" && job.errorCode === PERSIST_FAILED_DELIVERED;
}

/** Her own folder, exactly one level deep: `<her id>/<file>`. */
function isOwnImagePath(userId: string, path: string): boolean {
  const prefix = `${userId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/") && !rest.includes("..");
}

function canShowImage(userId: string | undefined, job: MemberGenerationJob | null | undefined) {
  return (
    !!userId &&
    !!job &&
    job.status === "succeeded" &&
    !!job.imagePath &&
    isOwnImagePath(userId, job.imagePath)
  );
}

/** The one fetch call the image reader makes (a seam for tests). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Reads a succeeded row's image through a short-lived signed URL and answers
 * it as a data URI, the same shape a fresh render arrives in, so saving and
 * downloading keep working unchanged. Only her own succeeded rows are ever
 * signed; her folder is never listed (N2).
 */
// src: https://supabase.com/docs/reference/javascript/storage-from-createsignedurl ·
//   supabase-js 2.110.0 — createSignedUrl(path, expiresIn) answers { data: { signedUrl }, error }
//   and needs SELECT on storage.objects (the migration's "members read their own folder" policy).
export async function loadGenerationImage(
  client: GenerationJobsClient,
  userId: string,
  job: MemberGenerationJob,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<string> {
  if (!canShowImage(userId, job)) {
    throw new Error("Only a finished picture from her own folder can be shown.");
  }
  const { data, error } = await client.storage
    .from(GENERATIONS_BUCKET)
    .createSignedUrl(job.imagePath as string, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw error ?? new Error("The picture could not be opened.");
  const response = await fetchImpl(data.signedUrl);
  if (!response.ok) throw new Error("The picture could not be loaded.");
  const blob = await response.blob();
  const type = IMAGE_TYPES.has(blob.type) ? blob.type : "image/jpeg";
  return `data:${type};base64,${base64(new Uint8Array(await blob.arrayBuffer()))}`;
}

export function generationImageQueryOptions(
  userId: string | undefined,
  job: MemberGenerationJob | null | undefined,
  options: { client?: GenerationJobsClient; fetchImpl?: FetchLike; enabled?: boolean } = {},
) {
  const client = options.client ?? supabase;
  return queryOptions({
    queryKey: generationJobKeys.image(userId, job?.id),
    queryFn: () =>
      loadGenerationImage(
        client,
        userId as string,
        job as MemberGenerationJob,
        options.fetchImpl ?? ((input, init) => fetch(input, init)),
      ),
    enabled: canShowImage(userId, job) && (options.enabled ?? true),
    // A job's image never changes once stored.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: memberQueryRetry,
  });
}

// ---------------------------------------------------------------------------
// Request ids (idempotency keys)
// ---------------------------------------------------------------------------

/** Sorted-key JSON that treats a null or missing optional field the same way, like the server. */
export function generationRequestKey(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((v) => generationRequestKey(v ?? null)).join(",")}]`;
  const object = record(value);
  if (object) {
    const keys = Object.keys(object)
      .filter((key) => object[key] !== undefined && object[key] !== null)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${generationRequestKey(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** What a look press asked for: the vibe and weather it is saved under (round 3). */
export type GenerationRequestAsked = { vibe: string | null; weather: string | null };

/**
 * One unanswered request: its id, the request it was sent for (`key`), when
 * it was first sent (`at`, the device's clock) and how many times the id has
 * been sent (`sends`). Absent `sends` means an entry kept before send counts
 * were (NEW-M2). `asked` is what its first press asked for (round 3).
 */
export type GenerationRequestEntry = {
  id: string;
  key: string;
  at: number;
  sends?: number;
  asked?: GenerationRequestAsked;
  /** When it was last sent (device clock; round 5). The id is kept, and its row awaited, from here. */
  lastAt?: number;
};

export type GenerationRequestLedger = {
  /**
   * The id this press sends: the unanswered one for the same request, or a
   * fresh uuid. A new id is ADDED; an earlier unanswered id is never evicted
   * (I1), so her paid job is still recognised as hers when it lands.
   */
  begin(
    userId: string,
    kind: ClientGenerationKind,
    key: string,
    asked?: GenerationRequestAsked,
  ): string;
  /**
   * A changed press sent under her unanswered id (NEW-M1: the check before it
   * timed out, so the server attaches or replays instead of charging again).
   * Counted as another send; null when the id is no longer hers to send.
   */
  reuse(userId: string, kind: ClientGenerationKind, id: string): string | null;
  /** Every request of this kind she sent from this tab and has not heard back from (oldest first). */
  pending(userId: string, kind: ClientGenerationKind): GenerationRequestEntry[];
  /** Her unanswered request with this id, if any. */
  owns(userId: string, kind: ClientGenerationKind, id: string): GenerationRequestEntry | null;
  /** The server answered this id (success or a real failure): only that id is retired. */
  settle(userId: string, kind: ClientGenerationKind, id: string): void;
  /**
   * This page already has the answer for this id, so a cached row still
   * saying "running" for it is out of date (it is refetched right away).
   */
  answered(id: string): boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const LEDGER_STORAGE_KEY = "mila.generation-requests.v2";
/** A job's deadline (300 s) plus the reaper's grace, with room to spare. */
const LEDGER_TTL_MS = 10 * 60 * 1000;

type LedgerState = Record<string, Partial<Record<ClientGenerationKind, GenerationRequestEntry[]>>>;

function isEntry(value: unknown): value is GenerationRequestEntry {
  const entry = record(value);
  return (
    !!entry &&
    typeof entry.id === "string" &&
    typeof entry.key === "string" &&
    typeof entry.at === "number" &&
    (entry.sends === undefined || typeof entry.sends === "number") &&
    (entry.asked === undefined || record(entry.asked) !== null) &&
    (entry.lastAt === undefined || typeof entry.lastAt === "number")
  );
}

/**
 * Remembers, per member and kind, EVERY request this tab sent and has not
 * heard back from. A second press of the same request reuses its id (one
 * charge: the server replays or attaches); a changed press gets a new id
 * without forgetting the earlier one; and after a reload the tab can tell its
 * own jobs' rows apart from ones made elsewhere. Kept in sessionStorage, so it
 * follows a reload or a discarded tab but never another tab; memory when
 * storage throws. Keyed by member, so a different sign-in never inherits ids.
 */
export function createGenerationRequestLedger(
  options: {
    storage?: () => StorageLike | null;
    now?: () => number;
    newId?: () => string;
    ttlMs?: number;
  } = {},
): GenerationRequestLedger {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const ttl = options.ttlMs ?? LEDGER_TTL_MS;
  let memory: LedgerState = {};
  const answeredIds = new Set<string>();

  const storage = () => {
    try {
      return options.storage ? options.storage() : null;
    } catch {
      return null;
    }
  };
  const read = (): LedgerState => {
    try {
      const raw = storage()?.getItem(LEDGER_STORAGE_KEY);
      if (raw) {
        const parsed = record(JSON.parse(raw));
        if (parsed) memory = parsed as LedgerState;
      }
    } catch {}
    return memory;
  };
  const write = (next: LedgerState) => {
    memory = next;
    try {
      storage()?.setItem(LEDGER_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  };
  const liveEntries = (state: LedgerState, userId: string, kind: ClientGenerationKind) => {
    const list = record(state[userId])?.[kind];
    if (!Array.isArray(list)) return [];
    return list.filter((entry) => isEntry(entry) && now() - (entry.lastAt ?? entry.at) < ttl);
  };
  const withEntries = (
    state: LedgerState,
    userId: string,
    kind: ClientGenerationKind,
    entries: GenerationRequestEntry[],
  ): LedgerState => ({ ...state, [userId]: { ...(state[userId] ?? {}), [kind]: entries } });
  /** The id is about to be sent again: count it (its first press time stays). */
  const sentAgain = (
    state: LedgerState,
    userId: string,
    kind: ClientGenerationKind,
    entries: GenerationRequestEntry[],
    id: string,
  ) =>
    write(
      withEntries(
        state,
        userId,
        kind,
        entries.map((entry) =>
          entry.id === id ? { ...entry, sends: (entry.sends ?? 1) + 1, lastAt: now() } : entry,
        ),
      ),
    );

  return {
    begin(userId, kind, key, asked) {
      const state = read();
      const entries = liveEntries(state, userId, kind);
      const same = entries.find((entry) => entry.key === key);
      if (same) {
        sentAgain(state, userId, kind, entries, same.id);
        return same.id;
      }
      const id = newId();
      const entry: GenerationRequestEntry = {
        id,
        key,
        at: now(),
        sends: 1,
        ...(asked ? { asked } : {}),
      };
      write(withEntries(state, userId, kind, [...entries, entry]));
      return id;
    },
    reuse(userId, kind, id) {
      const state = read();
      const entries = liveEntries(state, userId, kind);
      if (!entries.some((entry) => entry.id === id)) return null;
      sentAgain(state, userId, kind, entries, id);
      return id;
    },
    pending(userId, kind) {
      return liveEntries(read(), userId, kind);
    },
    owns(userId, kind, id) {
      return liveEntries(read(), userId, kind).find((entry) => entry.id === id) ?? null;
    },
    settle(userId, kind, id) {
      answeredIds.add(id);
      const state = read();
      const entries = liveEntries(state, userId, kind);
      if (!entries.some((entry) => entry.id === id)) return;
      write(
        withEntries(
          state,
          userId,
          kind,
          entries.filter((entry) => entry.id !== id),
        ),
      );
    },
    answered(id) {
      return answeredIds.has(id);
    },
  };
}

/**
 * Before sending a press whose request differs from one she sent earlier and
 * never heard back from, her latest row decides (I1):
 * - "attach": that earlier job of hers is still being made. Show it, send nothing.
 * - "recover": it finished. Show it (she paid for it), send nothing.
 * - "send": no such job is running or finished (none, someone else's, failed,
 *   or dead and about to be refunded). Send the new press.
 */
export function pressDecision(
  job: MemberGenerationJob | null | undefined,
  pendingIds: readonly string[],
  now: number,
  isAlive?: (jobId: string) => boolean,
): "attach" | "recover" | "send" {
  if (!job || !pendingIds.includes(job.clientRequestId)) return "send";
  if (isJobInProgress(job, now, isAlive)) return "attach";
  // Only a look that can be shown is recovered; otherwise the press is not swallowed.
  if (job.status === "succeeded" && storedLookFromJob(job)) return "recover";
  return "send";
}

/** How long the check before a changed press may take (NEW-M1). */
export const JOB_CHECK_TIMEOUT_MS = 8_000;

/** A read within a time limit: its answer, an error answer, or no answer in time. */
export type BoundedRead<TState> =
  { status: "read"; state: TState } | { status: "failed" } | { status: "timed_out" };

/** Her latest row, read within a time limit. */
export type BoundedJobRead = BoundedRead<GenerationJobState>;

/**
 * Runs `read` with `timeoutMs`: past it, the read's signal is aborted and the
 * answer is `timed_out`; an error is `failed`. Never waits for the network to
 * come back (no TanStack pause).
 */
async function readWithin<TState>(
  timeoutMs: number,
  read: (signal: AbortSignal) => Promise<TState>,
): Promise<BoundedRead<TState>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<BoundedRead<TState>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: "timed_out" });
    }, timeoutMs);
  });
  const answer = read(controller.signal).then(
    (state): BoundedRead<TState> => ({ status: "read", state }),
    (): BoundedRead<TState> =>
      controller.signal.aborted ? { status: "timed_out" } : { status: "failed" },
  );
  try {
    return await Promise.race([answer, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Her newest row of one kind, read with a time limit (NEW-M1): the session
 * read and the row read together get `timeoutMs`, and a read still running
 * then is aborted. It never waits for the network to come back (no TanStack
 * pause), and a missing table answers `unavailable`, remembered like the
 * page's own query.
 */
export async function readLatestJobWithin(
  userId: string,
  kind: ClientGenerationKind,
  options: {
    client?: GenerationJobsClient;
    availability?: JobsAvailability;
    timeoutMs?: number;
  } = {},
): Promise<BoundedJobRead> {
  const client = options.client ?? supabase;
  const availability = options.availability ?? generationJobsAvailability;
  return readWithin(options.timeoutMs ?? JOB_CHECK_TIMEOUT_MS, async (signal) => {
    if (availability.isMissing()) return { status: "unavailable" } as const;
    const authorization = await memberAuthorization(client.auth, userId);
    const state = await fetchLatestGenerationJob(client, userId, kind, authorization, { signal });
    if (state.status === "unavailable") availability.markMissing();
    else availability.markPresent();
    return state;
  });
}

/**
 * Her rows for these request ids (her unanswered presses), read within the
 * same time limit as her latest row (round 3), with the same availability
 * memory.
 */
export async function readOwnJobsWithin(
  userId: string,
  kind: ClientGenerationKind,
  requestIds: readonly string[],
  options: {
    client?: GenerationJobsClient;
    availability?: JobsAvailability;
    timeoutMs?: number;
  } = {},
): Promise<BoundedRead<OwnJobsState>> {
  const client = options.client ?? supabase;
  const availability = options.availability ?? generationJobsAvailability;
  return readWithin(options.timeoutMs ?? JOB_CHECK_TIMEOUT_MS, async (signal) => {
    if (availability.isMissing()) return { status: "unavailable" } as const;
    const authorization = await memberAuthorization(client.auth, userId);
    const state = await fetchGenerationJobsByRequestIds(
      client,
      userId,
      kind,
      requestIds,
      authorization,
      { signal },
    );
    if (state.status === "unavailable") availability.markMissing();
    else availability.markPresent();
    return state;
  });
}

/** What a changed press does, given what the check before it found (NEW-M1). */
export type ChangedPressPlan =
  | { action: "attach" }
  | { action: "recover" }
  | { action: "send" }
  /** Sent under her unanswered id: the server attaches to or replays that job, never charging twice. */
  | { action: "send_as"; id: string };

/**
 * A changed press while earlier requests of hers are unanswered (`earlier`,
 * oldest first):
 * - her rows answered (her latest row, or her rows read by id, round 3):
 *   `pressDecision` decides for each; one still being made attaches, else one
 *   finished is recovered, else the press is sent;
 * - no answer in time, or an error answer (round 3 ruling: never a refusal):
 *   the press goes ahead under this request's own unanswered id when it has
 *   one (round 4, I-A), else her latest unanswered id, so a double charge
 *   stays impossible (the server answers a known id with its own job, and
 *   starts one only if that request never arrived); with nothing unanswered,
 *   the new press proceeds.
 */
export function changedPressPlan(
  read: BoundedRead<GenerationJobState | OwnJobsState>,
  earlier: readonly GenerationRequestEntry[],
  now: number,
  isAlive?: (jobId: string) => boolean,
  /**
   * This press's own unanswered id (an earlier press of the SAME request).
   * With no answer it is the one sent under (round 4, I-A): the server replays
   * that request's job for free, where another request's id could start a
   * second, charged job for it.
   */
  sameRequestId?: string | null,
): ChangedPressPlan {
  if (read.status !== "read") {
    if (sameRequestId) return { action: "send_as", id: sameRequestId };
    const latest = earlier.at(-1);
    return latest ? { action: "send_as", id: latest.id } : { action: "send" };
  }
  if (read.state.status === "unavailable") return { action: "send" };
  const jobs = "jobs" in read.state ? read.state.jobs : [read.state.job];
  const ids = earlier.map((entry) => entry.id);
  const decisions = jobs.map((job) => pressDecision(job, ids, now, isAlive));
  if (decisions.includes("attach")) return { action: "attach" };
  if (decisions.includes("recover")) return { action: "recover" };
  return { action: "send" };
}

/**
 * The check before a press, as state the page can show (NEW-M1): kept
 * outside React, so it outlives a remount, and subscribable
 * (`useSyncExternalStore`), so Create shows "Checking your last look…"
 * while it runs. One check at a time.
 */
export function createPressCheck() {
  let checking = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (checking === next) return;
    checking = next;
    for (const listener of listeners) listener();
  };
  return {
    isChecking: () => checking,
    /** Starts the check; false when one is already running (that press does nothing). */
    start: (): boolean => {
      if (checking) return false;
      set(true);
      return true;
    },
    finish: () => set(false),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The page's check before a changed Create press. */
export const lastLookPressCheck = createPressCheck();

/**
 * Whether the device is offline (NEW-M1): TanStack Query's online manager
 * (which assumes online until an `offline` event) or the browser's own flag
 * (which catches a page opened offline). A browser that says it is online may
 * still be wrong; that press then fails at once, it is never held.
 */
// src: https://tanstack.com/query/v5/docs/reference/onlineManager ("assumes an active network
//   connection, and listens to the `online` and `offline` events") · @tanstack/react-query 5.101.2
export function deviceIsOffline(
  online: { isOnline(): boolean } = onlineManager,
  browser: { onLine?: boolean } | null = typeof navigator === "undefined" ? null : navigator,
): boolean {
  return !online.isOnline() || browser?.onLine === false;
}

/** The tab's own ledger. */
export const generationRequests = createGenerationRequestLedger({
  storage: () => (typeof window === "undefined" ? null : window.sessionStorage),
});

/**
 * The call got an answer that is not Mila's (round 5, m-3): a gateway page
 * (502/503/504) or any other response the app server did not write. The job
 * may still be running, so it is a lost answer, never a refusal: the id is
 * kept, and she is told calmly, never the page's raw text.
 */
export class LostAnswerError extends Error {
  constructor(status: number) {
    super(`No answer from Mila (${status}).`);
    this.name = "LostAnswerError";
  }
}

// src: https://unpkg.com/@tanstack/start-client-core@1.170.34/src/client-rpc/serverFnFetcher.ts
//   (a per-call `fetch` is used when given: `first.fetch ?? handler`; a response the Start
//   server serialized carries `x-tss-serialized` and its error is rethrown as itself; any
//   other non-OK, non-JSON answer becomes `new Error(await response.text())`, and a foreign
//   JSON body is returned as the result) and src/constants.ts (`x-tss-serialized`,
//   `x-tss-raw`) · @tanstack/start-client-core 1.170.34
const START_SERIALIZED = "x-tss-serialized";
const START_RAW = "x-tss-raw";

/** The fetch a server function call accepts per call (`fetch` option). */
export type GenerationFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * The fetch every generation call goes through (round 5, m-3): a non-OK
 * answer the app server did not write is a LostAnswerError. Mila's own
 * answers, refusals included, pass through unchanged.
 */
export function guardGenerationFetch(
  fetchImpl: GenerationFetch = (input, init) => fetch(input, init),
): GenerationFetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    const ours =
      !!response.headers.get(START_SERIALIZED) || response.headers.get(START_RAW) === "true";
    if (!response.ok && !ours) throw new LostAnswerError(response.status);
    return response;
  };
}

/** The page's guarded fetch for generation calls. */
export const generationFetch = guardGenerationFetch();

const LOST_ANSWER_NOUN: Record<ClientGenerationKind, string> = {
  look: "look",
  style_sheet: "style sheet",
  photo_preview: "portrait",
};

/**
 * What she is told when a call lost its answer and her row does not speak
 * for it (round 5, m-3): calm, and true, since the same press reuses its id.
 */
export function lostAnswerNotice(kind: ClientGenerationKind): string {
  const again = kind === "look" ? "Press Create again" : "Try again";
  return `The connection dropped before your ${LOST_ANSWER_NOUN[kind]} came back. ${again}: you won't be charged twice.`;
}

/**
 * A refusal because her session is reconnecting (round 5, m-3): the fetch
 * guard's own answer, or the server's "Unauthorized" for a call sent while
 * her token could not be read. Nothing ran and nothing was charged.
 */
export function isSessionRefusal(error: unknown): boolean {
  if (isMemberSessionUnavailable(error)) return true;
  return error instanceof Error && /^Unauthorized\b/.test(error.message);
}

const LOST_CONNECTION =
  /failed to fetch|networkerror|network request failed|load failed|network connection was lost/i;

/**
 * True when the call ended without an answer from the server (a client-side
 * timeout, a dropped connection, a stale bundle): the job may still be running
 * or may have finished, so the id is kept and the job row decides.
 */
export function isUnknownGenerationOutcome(error: unknown): boolean {
  if (error instanceof Error && error.name === "TimeoutError") return true;
  if (error instanceof Error && error.name === "LostAnswerError") return true;
  if (isStaleBundleError(error)) return true;
  return LOST_CONNECTION.test(errorMessage(error, ""));
}

// ---------------------------------------------------------------------------
// Counting a look once (round 5, m-4)
// ---------------------------------------------------------------------------

const TRACKED_STORAGE_KEY = "mila.generation-tracked.v1";
/** How many counted job ids a tab remembers (the newest). */
const MAX_TRACKED = 50;

/**
 * The look jobs this tab has already counted (`look_generated`), kept in
 * sessionStorage so a reload of the same tab never counts a job twice;
 * memory when storage throws.
 */
export function createTrackedJobs(options: { storage?: () => StorageLike | null } = {}) {
  let memory: string[] = [];
  const storage = () => {
    try {
      return options.storage ? options.storage() : null;
    } catch {
      return null;
    }
  };
  const read = (): string[] => {
    try {
      const raw = storage()?.getItem(TRACKED_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          memory = parsed.filter((id): id is string => typeof id === "string");
        }
      }
    } catch {}
    return memory;
  };
  return {
    /** True the first time this job is seen here (and remembers it). */
    firstTime(jobId: string): boolean {
      const seen = read();
      if (seen.includes(jobId)) return false;
      memory = [...seen, jobId].slice(-MAX_TRACKED);
      try {
        storage()?.setItem(TRACKED_STORAGE_KEY, JSON.stringify(memory));
      } catch {}
      return true;
    },
  };
}
export type TrackedJobs = ReturnType<typeof createTrackedJobs>;

/** The tab's counted look jobs. */
export const trackedLookJobs = createTrackedJobs({
  storage: () => (typeof window === "undefined" ? null : window.sessionStorage),
});

/**
 * The `look_generated` event for an answer, or null (round 5, m-4): never
 * for a stored job (`replayed`: a same-request replay or an attach to
 * another request's job), and once per job per tab. Its vibe is the job's
 * own (what the look was asked for), never the form's.
 */
export function lookEventFor(input: {
  jobId: string | null | undefined;
  replayed?: boolean;
  vibe: string | null;
  tracked: TrackedJobs;
}): { vibe: string | null } | null {
  if (input.replayed) return null;
  if (input.jobId && !input.tracked.firstTime(input.jobId)) return null;
  return { vibe: input.vibe };
}

// ---------------------------------------------------------------------------
// Waiting copy
// ---------------------------------------------------------------------------

type Stage = { from: number; stage: string };

const STAGES: Record<ClientGenerationKind, Stage[]> = {
  look: [
    { from: 0, stage: "Reading the weather and your palette" },
    { from: 20_000, stage: "Choosing pieces" },
    { from: 100_000, stage: "Putting your look together" },
    { from: 180_000, stage: "Adding the finishing touches" },
  ],
  style_sheet: [
    { from: 0, stage: "Preparing your photo" },
    { from: 20_000, stage: "Drawing your style sheet" },
    { from: 100_000, stage: "Checking every view" },
    { from: 180_000, stage: "Adding the finishing touches" },
  ],
  photo_preview: [
    { from: 0, stage: "Preparing your photo" },
    { from: 20_000, stage: "Dressing your portrait" },
    { from: 100_000, stage: "Checking the details" },
    { from: 180_000, stage: "Adding the finishing touches" },
  ],
};

function timeHint(elapsedMs: number): string {
  if (elapsedMs < 100_000) return "about 2 minutes";
  if (elapsedMs < 180_000) return "about a minute more";
  return "almost there";
}

/**
 * Staged wait copy: "Choosing pieces · about 2 minutes · you can leave this
 * page". "You can leave" is said only when it is true (jobs are live, so the
 * result is kept for her).
 */
export type GenerationWait = {
  /** "Choosing pieces" */
  stage: string;
  /** "About 2 minutes · you can leave this page" */
  detail: string;
  /** "Choosing pieces · about 2 minutes · you can leave this page" */
  line: string;
};

function capitalised(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function generationWaitCopy(
  kind: ClientGenerationKind,
  elapsedMs: number,
  options: { canLeave: boolean; reconnecting?: boolean },
): GenerationWait {
  const elapsed = Math.max(0, elapsedMs);
  const stage = [...STAGES[kind]].reverse().find((s) => elapsed >= s.from)?.stage ?? "";
  const hints = options.reconnecting
    ? ["Reconnecting, nothing is lost"]
    : [timeHint(elapsed), ...(options.canLeave ? ["you can leave this page"] : [])];
  const detail = hints.join(" · ");
  return { stage, detail: capitalised(detail), line: [stage, detail].join(" · ") };
}

// ---------------------------------------------------------------------------
// Reaping
// ---------------------------------------------------------------------------

/** Waits between reap attempts on the same dead job (M4): bounded, growing. */
export const REAP_BACKOFF_MS: readonly number[] = [15_000, 45_000, 120_000, 300_000];
/** After this many attempts the nightly cron takes over; the page stops asking. */
export const MAX_REAP_ATTEMPTS = 5;

type ReapRecord = {
  /** Reap attempts made for this job. */
  count: number;
  /** The next attempt is not before this (device clock). */
  nextAt: number;
  /** The server found nothing to reap: on its clock the job is still alive. */
  alive: boolean;
  /** When the last attempt was made (device clock). */
  at: number;
};

const REAP_STORAGE_KEY = "mila.generation-reaps.v1";
/** A job's record is dropped this long after its last attempt (the tab's storage stays small). */
const REAP_MEMORY_TTL_MS = 24 * 60 * 60 * 1000;

function isReapRecord(value: unknown): value is ReapRecord {
  const entry = record(value);
  return (
    !!entry &&
    typeof entry.count === "number" &&
    typeof entry.nextAt === "number" &&
    typeof entry.alive === "boolean" &&
    typeof entry.at === "number"
  );
}

/**
 * What the reaper remembers, per job, for the life of the tab: how many times
 * it asked, when it may ask again, and whether the server said the job is
 * still alive. Kept in sessionStorage (memory when storage throws), so leaving
 * the page and coming back, or reloading, never starts the count again; the
 * attempts stay bounded per job. Which call is in flight is shared too.
 */
export function createReapMemory(options: { storage?: () => StorageLike | null } = {}) {
  let memory: Record<string, ReapRecord> = {};
  let inFlight = false;
  const storage = () => {
    try {
      return options.storage ? options.storage() : null;
    } catch {
      return null;
    }
  };
  const read = (): Record<string, ReapRecord> => {
    try {
      const raw = storage()?.getItem(REAP_STORAGE_KEY);
      if (raw) {
        const parsed = record(JSON.parse(raw));
        if (parsed) {
          memory = Object.fromEntries(
            Object.entries(parsed).filter(([, value]) => isReapRecord(value)),
          ) as Record<string, ReapRecord>;
        }
      }
    } catch {}
    return memory;
  };
  const write = (next: Record<string, ReapRecord>) => {
    memory = next;
    try {
      storage()?.setItem(REAP_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  };
  return {
    get: (jobId: string): ReapRecord | null => read()[jobId] ?? null,
    set: (jobId: string, next: ReapRecord, deviceNow: number) => {
      const kept = Object.fromEntries(
        Object.entries(read()).filter(([, value]) => deviceNow - value.at < REAP_MEMORY_TTL_MS),
      );
      write({ ...kept, [jobId]: next });
    },
    beginCall: (): boolean => {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    endCall: () => {
      inFlight = false;
    },
  };
}
export type ReapMemory = ReturnType<typeof createReapMemory>;

/** The tab's reaper memory, shared by every mount of the page. */
export const generationReaps = createReapMemory({
  storage: () => (typeof window === "undefined" ? null : window.sessionStorage),
});

/**
 * Calls `reapMyGenerationJobs` for the dead jobs she is shown (a row still
 * "running" 30 s past its deadline, on the server's clock: its server was
 * ended), so the credit comes back now rather than at her next generation or
 * the nightly cron.
 * - Attempts per job are bounded (MAX_REAP_ATTEMPTS) and spaced out
 *   (REAP_BACKOFF_MS), whether the call failed or found nothing to reap (M4).
 * - A reap that found nothing means the server, on its own clock, still sees
 *   the job alive: it is treated as running (`isAlive`) until it settles (M3).
 * - Her rows are refreshed after every attempt (`afterReap`).
 * - What it remembers lives in `memory`, per job: the page passes the tab's
 *   session-stored memory, so leaving and coming back keeps the count.
 * `deviceNow` (the device clock) only times the backoff.
 */
export function createStaleJobReaper(deps: {
  reap: () => Promise<{ available: boolean; reaped: number }>;
  afterReap: () => void;
  backoffMs?: readonly number[];
  maxAttempts?: number;
  memory?: ReapMemory;
}) {
  const backoff = deps.backoffMs ?? REAP_BACKOFF_MS;
  const maxAttempts = deps.maxAttempts ?? MAX_REAP_ATTEMPTS;
  const memory = deps.memory ?? createReapMemory();
  return {
    isAlive: (jobId: string) => memory.get(jobId)?.alive ?? false,
    attemptsFor: (jobId: string) => memory.get(jobId)?.count ?? 0,
    async consider(
      jobs: Array<MemberGenerationJob | null | undefined>,
      now: number,
      deviceNow: number = Date.now(),
    ) {
      const due = jobs.filter((job): job is MemberGenerationJob => {
        if (!job || generationJobPhase(job, now) !== "stale") return false;
        const state = memory.get(job.id);
        return !state || (state.count < maxAttempts && deviceNow >= state.nextAt);
      });
      if (due.length === 0) return;
      if (!memory.beginCall()) return;
      for (const job of due) {
        const before = memory.get(job.id);
        const count = (before?.count ?? 0) + 1;
        const wait = backoff[Math.min(count - 1, backoff.length - 1)] ?? 0;
        memory.set(
          job.id,
          { count, nextAt: deviceNow + wait, alive: before?.alive ?? false, at: deviceNow },
          deviceNow,
        );
      }
      try {
        const result = await deps.reap();
        // Nothing to reap: on the server's clock these jobs are still alive.
        if (result.available && result.reaped === 0) {
          for (const job of due) {
            const state = memory.get(job.id);
            if (state) memory.set(job.id, { ...state, alive: true }, deviceNow);
          }
        }
      } catch {
        // Offline or the call failed: tried again after the backoff.
      } finally {
        memory.endCall();
      }
      deps.afterReap();
    },
  };
}
