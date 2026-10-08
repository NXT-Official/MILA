import { useCallback, useEffect, useRef, useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { queryKeys } from "@/constants/query-keys";
import { HAIR_COLORS, SKIN_DEPTHS } from "@/constants/style-profile";
import type { ColorAnalysisResult, StudioColorProfile } from "@/lib/analyzePersonalColor.functions";
import {
  ANALYSIS_POLL_MS,
  ANALYSIS_REAP_GRACE_MS,
  analysisJobOffer,
  rememberDismissed,
} from "@/lib/analysis-job-offer";
import { COLOR_READ_STALE_BUNDLE } from "@/lib/color-read-errors";
import { reapMyGenerationJobs } from "@/lib/generation-jobs.functions";
import {
  latestAnalysisJobQueryOptions,
  type AnalysisJob,
  type AnalysisJobState,
  type AnalysisJobsClient,
} from "@/lib/queries/analysis-jobs";
import {
  REAP_ALIVE_MS,
  createReapGate,
  featureClock,
  isLostAnswer,
  onFeaturePageReturn,
  reapOnce,
} from "@/lib/queries/feature-jobs";
import { errorMessage, isStaleBundleError, withTimeout } from "@/lib/utils";

/**
 * Her colour read never strands her (Wave D plan, D-W2).
 *
 * - The press: one request per capture, with its own `clientRequestId`. A
 *   request whose answer was lost keeps its id, so "Try again" replays the
 *   same job instead of charging twice.
 * - The call: bounded at 175 s and sent through a guarded fetch, so a timeout,
 *   a dropped connection or a gateway page is a lost answer (the job decides),
 *   never a failure.
 * - The job: her latest `color_read` row (D-W0's query, read within 8 s) and
 *   what it means now (`analysisJobOffer`), judged with the clock as it is at
 *   each render.
 */

// ---------------------------------------------------------------------------
// The press
// ---------------------------------------------------------------------------

/** How long the viewfinder waits for a read before it shows "still reading". */
export const COLOR_READ_CLIENT_TIMEOUT_MS = 175_000;
/** Every read of her job row gives up after this long. */
export const COLOR_READ_JOB_READ_TIMEOUT_MS = 8_000;
/** After a lost answer, how long her request's row is waited for before it reads as lost. */
export const COLOR_READ_ROW_WAIT_MS = 20_000;

/** The tricky-light sample: a backlit, high-contrast calibration, forced. */
const STRESS_TEST_CALIBRATION = {
  ambientLighting: "backlit",
  biologicalUndertone: "cool_blue",
  computedContrast: "high",
} as const;

/** One press of the shutter (or one picked photo): its photo and its id. */
export type ColorReadRequest = {
  id: string;
  imageBase64: string;
  mimeType: string;
  stressTest: boolean;
};

export function createColorReadRequest(
  input: { imageBase64: string; mimeType: string; stressTest?: boolean },
  newId: () => string = () => crypto.randomUUID(),
): ColorReadRequest {
  return {
    id: newId(),
    imageBase64: input.imageBase64,
    mimeType: input.mimeType,
    stressTest: input.stressTest === true,
  };
}

/** The server function's input for a request. */
export function colorReadData(request: ColorReadRequest) {
  return {
    imageBase64: request.imageBase64,
    diagnostics: request.stressTest ? { forceCalibration: STRESS_TEST_CALIBRATION } : undefined,
    clientRequestId: request.id,
  };
}
export type ColorReadData = ReturnType<typeof colorReadData>;

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export type ColorReadFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * The call got an answer that is not Mila's: a gateway page (502/503/504) or
 * any other response the app server did not write. The read may still be
 * running, so it is a lost answer, never a refusal: the id is kept.
 */
export class ColorReadLostAnswerError extends Error {
  constructor(status: number) {
    super(`No answer from Mila (${status}).`);
    this.name = "LostAnswerError";
  }
}

// src: https://unpkg.com/@tanstack/start-client-core@1.170.34/src/client-rpc/serverFnFetcher.ts
//   (a per-call `fetch` is used when given: `first.fetch ?? handler`; a response the Start
//   server wrote carries `x-tss-serialized`; any other non-OK answer becomes
//   `new Error(await response.text())`; a 200 JSON body is returned as the result) ·
//   @tanstack/start-client-core 1.170.34
const START_SERIALIZED = "x-tss-serialized";
const START_RAW = "x-tss-raw";

/** A non-OK answer the app server did not write is a ColorReadLostAnswerError. */
export function guardColorReadFetch(
  fetchImpl: ColorReadFetch = (input, init) => fetch(input, init),
): ColorReadFetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    const ours =
      !!response.headers.get(START_SERIALIZED) || response.headers.get(START_RAW) === "true";
    if (!response.ok && !ours) throw new ColorReadLostAnswerError(response.status);
    return response;
  };
}

export const colorReadFetch = guardColorReadFetch();

export type ColorReadTelemetry = Extract<ColorAnalysisResult, { success: true }>["telemetry"];

/** The read's server function as the viewfinder calls it. */
export type AnalyzeColorFn = (options: {
  data: ColorReadData;
  fetch?: ColorReadFetch;
}) => Promise<ColorAnalysisResult>;

export type ColorReadOutcome =
  | {
      kind: "read";
      profile: StudioColorProfile;
      telemetry: ColorReadTelemetry;
      /** The job that holds this read; null on the legacy path. */
      jobId: string | null;
    }
  /** Mila answered and refused: `code` is hers to map (describeColorReadError). */
  | { kind: "refused"; code: string }
  /** No answer we can read: the read may still be running. Keep the request and its id. */
  | { kind: "lost" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isColorAnalysisResult(value: unknown): value is ColorAnalysisResult {
  if (!isRecord(value) || typeof value.success !== "boolean") return false;
  return value.success
    ? isRecord(value.profile) && isRecord(value.telemetry)
    : typeof value.error === "string";
}

/**
 * Sends one request and says what came of it. Never throws.
 * - A read, with its job id.
 * - Mila's refusal (her code), including an error her server threw.
 * - A stale bundle: the call never reached the read, so she is asked to refresh.
 * - Lost: the client's 175 s limit, a dropped connection, a gateway page, or a
 *   body that is not Mila's answer. The job may still be running.
 */
export async function runColorRead(
  analyze: AnalyzeColorFn,
  request: ColorReadRequest,
  deps: {
    withTimeout?: <T>(promise: Promise<T>, ms: number) => Promise<T>;
    fetch?: ColorReadFetch;
  } = {},
): Promise<ColorReadOutcome> {
  const bound = deps.withTimeout ?? withTimeout;
  try {
    const result = await bound(
      analyze({ data: colorReadData(request), fetch: deps.fetch ?? colorReadFetch }),
      COLOR_READ_CLIENT_TIMEOUT_MS,
    );
    if (!isColorAnalysisResult(result)) return { kind: "lost" };
    if (!result.success) return { kind: "refused", code: result.error };
    return {
      kind: "read",
      profile: result.profile,
      telemetry: result.telemetry,
      jobId: result.jobId ?? null,
    };
  } catch (error) {
    if (isStaleBundleError(error)) return { kind: "refused", code: COLOR_READ_STALE_BUNDLE };
    if (isColorReadLostAnswer(error)) return { kind: "lost" };
    return { kind: "refused", code: errorMessage(error, "") };
  }
}

/** The call ended without Mila's answer: keep the id, and let the job row decide. */
export function isColorReadLostAnswer(error: unknown): boolean {
  if (error instanceof Error && error.name === "LostAnswerError") return true;
  return isLostAnswer(error);
}

// ---------------------------------------------------------------------------
// The stored read
// ---------------------------------------------------------------------------

const HEX = /^#[0-9A-Fa-f]{6}$/;
const SwatchSchema = z.object({ hex: z.string().regex(HEX), name: z.string().min(1) });
const Text = z.string().min(1);

/** What a succeeded color_read job keeps (the server's StoredReadSchema), read on the client. */
const StoredProfileSchema = z.object({
  season: z.enum(["Spring", "Summer", "Autumn", "Winter"]),
  subSeason: Text,
  toneType: Text,
  brightness: Text,
  saturation: Text,
  contrastScale: Text,
  faceShape: Text,
  bodyType: Text,
  primarySwatches: z.array(SwatchSchema).min(1),
  secondarySwatches: z.array(SwatchSchema),
  avoidColors: z.array(z.string()),
  beautyMap: z.object({ hair: z.string(), lip: z.string(), base: z.string() }),
  fabrication: z.array(z.string()),
  accessories: z.array(z.string()),
  denimRegistry: z.array(z.string()),
  stylistNote: Text,
  fullPalette: z.array(z.string().regex(HEX)).optional(),
  detectedLighting: z.string().optional(),
  calculatedUndertone: z.string().optional(),
  confidenceScore: z.number().optional(),
  confidenceLabel: z.string().optional(),
  // Null is hair that could not be seen; a value off the list is dropped, never guessed.
  hairColor: z.enum(HAIR_COLORS).nullable().optional().catch(undefined),
  skinDepth: z.enum(SKIN_DEPTHS).optional().catch(undefined),
});

const StoredTelemetrySchema = z.object({
  pass1Raw: z.object({
    ambientLighting: z.string(),
    biologicalUndertone: z.string(),
    computedContrast: z.string(),
  }),
  interceptTriggered: z.boolean(),
  gatekeeperNotes: z.array(z.string()),
  pass2OverrideInputs: z.object({
    ambientLighting: z.string(),
    biologicalUndertone: z.string(),
    computedContrast: z.string(),
    sensorClippingEvent: z.boolean(),
  }),
  forcedDiagnostic: z.boolean(),
});

const StoredReadSchema = z.object({
  profile: StoredProfileSchema,
  telemetry: StoredTelemetrySchema,
});

export type StoredColorRead = { profile: StudioColorProfile; telemetry: ColorReadTelemetry };

/** Her stored read, or null when the row holds anything else. */
export function parseStoredColorRead(result: unknown): StoredColorRead | null {
  const parsed = StoredReadSchema.safeParse(result);
  if (!parsed.success) return null;
  const profile: Record<string, unknown> = { ...parsed.data.profile };
  // An absent field stays absent, never `undefined`.
  for (const key of ["hairColor", "skinDepth"] as const) {
    if (profile[key] === undefined) delete profile[key];
  }
  return {
    // The server checked every enum before it stored the read (StudioColorProfileSchema).
    profile: profile as unknown as StudioColorProfile,
    telemetry: parsed.data.telemetry,
  };
}

const storedReadParses = (result: unknown) => parseStoredColorRead(result) !== null;

// ---------------------------------------------------------------------------
// What her latest read means now
// ---------------------------------------------------------------------------

/** "lost": her request's answer was lost and no row of its own ever appeared. */
export type ColorReadOffer = "running" | "ready" | "failed" | "lost";

/** After a lost answer: the request whose row decides, and when the loss was seen. */
export type ColorReadFollow = { requestId: string; since: number };

export type ColorReadJobView = {
  /** False while the generation_jobs migration is missing: nothing is offered. */
  available: boolean;
  job: AnalysisJob | null;
  offer: ColorReadOffer | null;
  /** Her stored read, when `offer` is "ready". */
  read: StoredColorRead | null;
};

export type ColorReadViewContext = {
  /** Now, in ms (the server's time where known). Read at render, never kept. */
  now: number;
  dismissed?: readonly string[];
  /** The job her saved dossier came from (`dossier.readJobId`). */
  usedJobId?: string | null;
  /** When her current colour profile was saved (a read or a quiz). */
  appliedAt?: string | null;
  /** Set after a lost answer: only that request's own row speaks. */
  follow?: ColorReadFollow | null;
  /** An overdue row the server still sees alive (a reap found nothing). */
  isAlive?: (jobId: string) => boolean;
  /** A reap of this overdue row has been asked for and answered (or refused). */
  reapSettled?: (jobId: string) => boolean;
  sameLocalDay?: (a: number, b: number) => boolean;
};

const NOTHING: ColorReadJobView = { available: true, job: null, offer: null, read: null };

function settledView(
  job: AnalysisJob,
  raw: NonNullable<ReturnType<typeof analysisJobOffer>>,
  ctx: ColorReadViewContext,
): ColorReadJobView {
  let offer: ColorReadOffer;
  if (raw === "stale") {
    // Past the reaper's line: dead. Still reading until the reap answers, then failed
    // (the reaper or the nightly cron returns its credit), unless the server sees it alive.
    offer = ctx.isAlive?.(job.id) || !ctx.reapSettled?.(job.id) ? "running" : "failed";
  } else {
    offer = raw;
  }
  return {
    available: true,
    job,
    offer,
    read: offer === "ready" ? parseStoredColorRead(job.result) : null,
  };
}

export function colorReadJobView(
  state: AnalysisJobState | undefined,
  ctx: ColorReadViewContext,
): ColorReadJobView {
  if (state?.status === "unavailable") {
    return { available: false, job: null, offer: null, read: null };
  }
  const job = state?.status === "ready" ? state.job : null;
  const follow = ctx.follow ?? null;

  if (follow) {
    if (!job || job.clientRequestId !== follow.requestId) {
      // No row of its own yet: the request may still be on its way, or never arrived.
      const waiting = ctx.now - follow.since <= COLOR_READ_ROW_WAIT_MS;
      return { ...NOTHING, offer: waiting ? "running" : "lost" };
    }
    // Her own live request: never hidden as dismissed or saved.
    const raw = analysisJobOffer(job, {
      now: ctx.now,
      resultParses: storedReadParses,
      sameLocalDay: ctx.sameLocalDay,
    });
    // A row that cannot be shown: Try again resends the same id, and the server replays it.
    if (raw === null) return { ...NOTHING, job, offer: "lost" };
    return settledView(job, raw, ctx);
  }

  if (!job) return NOTHING;
  const raw = analysisJobOffer(job, {
    now: ctx.now,
    dismissedIds: ctx.dismissed,
    usedJobId: ctx.usedJobId,
    appliedAt: ctx.appliedAt,
    resultParses: storedReadParses,
    sameLocalDay: ctx.sameLocalDay,
  });
  if (raw === null) return { ...NOTHING, job };
  return settledView(job, raw, ctx);
}

/**
 * How often her row is read again: every 3 s while it is running (judged at
 * `now`), and while a lost request's row is still awaited. Never while the
 * table is missing, once the row is over, or once it is overdue (the reap
 * then refreshes it).
 */
export function colorReadPollMs(
  state: AnalysisJobState | undefined,
  ctx: { now: number; follow: ColorReadFollow | null; isAlive?: (jobId: string) => boolean },
): number | false {
  if (!state || state.status === "unavailable") return false;
  const job = state.job;
  if (ctx.follow && (!job || job.clientRequestId !== ctx.follow.requestId)) {
    return ctx.now - ctx.follow.since <= COLOR_READ_ROW_WAIT_MS ? ANALYSIS_POLL_MS : false;
  }
  if (!job || job.status !== "running") return false;
  const offer = analysisJobOffer(job, { now: ctx.now });
  return offer === "running" || ctx.isAlive?.(job.id) ? ANALYSIS_POLL_MS : false;
}

/** Her read still running inside its deadline, or null. */
export function runningColorReadJob(
  state: AnalysisJobState | undefined,
  now: number,
): AnalysisJob | null {
  if (state?.status !== "ready" || !state.job || state.job.status !== "running") return null;
  return analysisJobOffer(state.job, { now }) === "running" ? state.job : null;
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

/** The server's time now, as this tab estimates it. */
export const colorReadNow = (): number => featureClock.now();

const UNAVAILABLE_STALE_MS = 5 * 60_000;
const IDLE_STALE_MS = 30_000;

/**
 * The one part of TanStack's `Query` the poll reads. Structural on purpose:
 * the real query (keyed `readonly ["analysis-job", string | undefined, string]`)
 * is assignable to it, so the callbacks fit `staleTime` and `refetchInterval`
 * without naming the key tuple.
 */
type JobStateQuery = { state: { data: AnalysisJobState | undefined } };

/**
 * D-W0's latest color_read query, with every read bounded, the poll judged at
 * the moment it decides, and a refetch when she comes back to the tab.
 */
export function colorReadJobQueryOptions(
  userId: string | undefined,
  options: {
    client?: AnalysisJobsClient;
    enabled?: boolean;
    now?: () => number;
    follow?: () => ColorReadFollow | null;
    isAlive?: (jobId: string) => boolean;
    readTimeoutMs?: number;
  } = {},
) {
  const base = latestAnalysisJobQueryOptions(userId, "color_read", options.client);
  const read = base.queryFn;
  const clock = options.now ?? colorReadNow;
  const poll = (query: JobStateQuery) =>
    colorReadPollMs(query.state.data, {
      now: clock(),
      follow: options.follow?.() ?? null,
      isAlive: options.isAlive,
    });
  return queryOptions({
    ...base,
    // The query layer gives up on a read after 8 s (the request itself is not
    // cancelled: D-W0's read takes no signal), and memberQueryRetry retries it.
    queryFn: (context) => {
      // D-W0's reader is always a function; `skipToken` (a symbol) never reaches here.
      if (typeof read !== "function") {
        return Promise.reject(new Error("The color read query has no reader."));
      }
      return withTimeout(
        Promise.resolve(read(context)),
        options.readTimeoutMs ?? COLOR_READ_JOB_READ_TIMEOUT_MS,
      );
    },
    enabled: !!userId && (options.enabled ?? true),
    // src: https://tanstack.com/query/v5/docs/framework/react/reference/useQuery
    //   (staleTime and refetchInterval accept a function of the query) · @tanstack/react-query 5.101.2
    staleTime: (query: JobStateQuery) => {
      if (query.state.data?.status === "unavailable") return UNAVAILABLE_STALE_MS;
      return poll(query) ? 0 : IDLE_STALE_MS;
    },
    refetchInterval: (query: JobStateQuery) => poll(query),
    refetchOnWindowFocus: true,
  });
}

// ---------------------------------------------------------------------------
// Dismissed ids (any Wave D read kind: job ids are unique)
// ---------------------------------------------------------------------------

const DISMISSED_PREFIX = "mila:analysis-dismissed:";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/**
 * The reads she dismissed or already took, per member, in localStorage
 * (memory when storage throws): the newest 20 (Wave D plan, section 3.5).
 */
export function createAnalysisDismissals(storage: () => StorageLike | null = defaultStorage) {
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
      const next = rememberDismissed(read(userId), jobId);
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

export const analysisDismissals = createAnalysisDismissals();

/** The tab's reap memory for colour reads. */
const colorReadReapGate = createReapGate();

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * Follows her latest colour read: running, ready, failed, or nothing; or,
 * after a lost answer, that one request's row (and "lost" if it never
 * appears). The offer is decided with the clock read in render, and the hook
 * re-renders when a running row crosses its stale line, when a lost request's
 * wait ends, and when she comes back to the tab.
 *
 * - Credits are refetched when a row moves from running to anything else.
 * - An overdue row is reaped once per 30 s (three times at most), then rows
 *   and credits refetch.
 * - While the migration is missing: no polling, no offer.
 */
export function useColorReadJob(
  userId: string | undefined,
  options: {
    usedJobId?: string | null;
    appliedAt?: string | null;
    follow?: ColorReadFollow | null;
    enabled?: boolean;
    now?: () => number;
    client?: AnalysisJobsClient;
  } = {},
) {
  const nowOverride = useRef(options.now);
  nowOverride.current = options.now;
  const now = useCallback(() => (nowOverride.current ?? colorReadNow)(), []);
  const follow = options.follow ?? null;
  const latestFollow = useRef(follow);
  latestFollow.current = follow;
  const queryClient = useQueryClient();
  const reap = useServerFn(reapMyGenerationJobs);
  const latestReap = useRef(reap);
  latestReap.current = reap;
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((n) => n + 1), []);
  const [reapSettledIds, setReapSettledIds] = useState<readonly string[]>([]);
  const isAlive = useCallback((jobId: string) => colorReadReapGate.isAlive(jobId), []);

  const query = useQuery(
    colorReadJobQueryOptions(userId, {
      client: options.client,
      enabled: options.enabled,
      now,
      follow: () => latestFollow.current,
      isAlive,
    }),
  );
  const view = colorReadJobView(query.data, {
    now: now(),
    dismissed: userId ? analysisDismissals.get(userId) : [],
    usedJobId: options.usedJobId,
    appliedAt: options.appliedAt,
    follow,
    isAlive,
    reapSettled: (jobId) => reapSettledIds.includes(jobId),
  });
  const { job } = view;
  const jobId = job?.id;

  // Credits: a running row that settled may have refunded or kept the charge.
  const lastStatus = useRef<{ id: string; status: string } | null>(null);
  useEffect(() => {
    const before = lastStatus.current;
    lastStatus.current = job ? { id: job.id, status: job.status } : null;
    if (before && job && before.id === job.id && before.status === "running") {
      if (job.status !== "running") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.credits(userId) });
      }
    }
  }, [job, userId, queryClient]);

  // Overdue: ask the server to fail and refund it (bounded by the gate).
  const overdue =
    !!job && job.status === "running" && analysisJobOffer(job, { now: now() }) === "stale";
  const aliveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!overdue || !jobId || !userId) return;
    void reapOnce(jobId, () => latestReap.current(), colorReadReapGate).then((answer) => {
      setReapSettledIds((ids) => (ids.includes(jobId) ? ids : [...ids, jobId]));
      if (answer?.available && answer.reaped === 0) {
        // Found nothing to reap: the server still sees it alive. Judge again once that lapses.
        clearTimeout(aliveTimer.current);
        aliveTimer.current = setTimeout(rerender, REAP_ALIVE_MS + 100);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.analysisJob(userId, "color_read") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.credits(userId) });
    });
  }, [overdue, jobId, userId, queryClient, rerender]);
  useEffect(() => () => clearTimeout(aliveTimer.current), []);

  // A running row turns overdue by the clock alone: wake up when it does.
  const deadlineAt = job?.status === "running" ? job.deadlineAt : null;
  useEffect(() => {
    if (!deadlineAt) return;
    const overdueAt = Date.parse(deadlineAt.replace(/(\.\d{3})\d+/, "$1")) + ANALYSIS_REAP_GRACE_MS;
    if (!Number.isFinite(overdueAt)) return;
    const wait = Math.min(Math.max(overdueAt - now(), 0) + 100, 2_147_000_000);
    const timer = setTimeout(rerender, wait);
    return () => clearTimeout(timer);
  }, [deadlineAt, rerender, now]);

  // A lost request's wait for its row ends by the clock alone: wake up then.
  const awaitingRow = !!follow && (!job || job.clientRequestId !== follow.requestId);
  const followSince = follow?.since;
  useEffect(() => {
    if (!awaitingRow || followSince === undefined) return;
    const wait = Math.max(followSince + COLOR_READ_ROW_WAIT_MS - now(), 0) + 100;
    const timer = setTimeout(rerender, wait);
    return () => clearTimeout(timer);
  }, [awaitingRow, followSince, rerender, now]);

  // Coming back to the tab judges again with the clock as it is now.
  useEffect(() => {
    return onFeaturePageReturn(typeof window === "undefined" ? null : window, rerender);
  }, [rerender]);

  /** Never offer this job again: she dismissed it, or she took its result. */
  const dismiss = useCallback(
    (id: string | undefined = jobId) => {
      if (!userId || !id) return;
      analysisDismissals.add(userId, id);
      rerender();
    },
    [userId, jobId, rerender],
  );

  return { ...view, dismiss };
}
