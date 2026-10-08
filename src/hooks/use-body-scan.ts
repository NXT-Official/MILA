import { useCallback, useEffect, useRef, useState } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BODIES, type BodyType } from "@/constants/style-profile";
import { queryKeys } from "@/constants/query-keys";
import { INSUFFICIENT_CREDITS } from "@/lib/credits";
import { analysisJobOffer, rememberDismissed } from "@/lib/analysis-job-offer";
import {
  BODY_SCAN_CODES,
  BODY_SCAN_MAX_PHOTO_CHARS,
  BODY_SCAN_STILL_FINISHING,
  describeBodyScanError,
  isBodyScanInFlight,
  isLostBodyScanAnswer,
  type BodyScanFailure,
} from "@/lib/body-scan-errors";
import { runBodyScan, type BodyScanResult } from "@/lib/check-in.functions";
import { reapMyGenerationJobs } from "@/lib/generation-jobs.functions";
import { latestAnalysisJobQueryOptions, type AnalysisJobState } from "@/lib/queries/analysis-jobs";
import { withTimeout } from "@/lib/utils";

/**
 * "Scan my shape" (Wave D plan, D-W5): one full-length photo, one suggested
 * silhouette. The scan never writes her body type; she chooses (R-3).
 *
 * - Every press carries a `clientRequestId`. A double press sends one
 *   request; "Try again" after a lost answer resends the same photo with the
 *   same id (the server replays it, so she never pays twice); after an answer
 *   the next press is a new request.
 * - The call is a mutation under `["body-scan"]` that never retries and is
 *   never kept once settled (`gcTime: 0`, R-4: the photo is in its variables).
 *   While it runs it stays in the mutation cache, so leaving the page and
 *   coming back still shows "reading"; when it lands, the hook-level
 *   `onSettled` refreshes her `body_scan` job row, which then offers the
 *   result (R7).
 */

export const BODY_SCAN_MUTATION_KEY = ["body-scan"] as const;

/** The server gives the AI call 110 s; past this, the answer is treated as lost. */
export const BODY_SCAN_CLIENT_TIMEOUT_MS = 130_000;

/** A cleared answer's own job row may finish a little after she cleared it. */
export const CLEARED_SKEW_MS = 60_000;

export type BodyScanVariables = { bodyImageBase64: string; clientRequestId: string };

// src: https://tanstack.com/query/v5/docs/framework/react/reference/useMutation
//   (mutationKey, retry, gcTime, networkMode, onSettled) · @tanstack/react-query 5.101.2
export function bodyScanMutationOptions(
  send: (variables: BodyScanVariables) => Promise<BodyScanResult>,
  queryClient: QueryClient,
  userId: string | undefined,
) {
  return {
    mutationKey: BODY_SCAN_MUTATION_KEY,
    mutationFn: (variables: BodyScanVariables) =>
      withTimeout(send(variables), BODY_SCAN_CLIENT_TIMEOUT_MS),
    retry: false as const,
    gcTime: 0,
    networkMode: "always" as const,
    onSettled: () => {
      // A finished scan may have moved her job row, spent her founding scan
      // (the price changes) or charged and refunded a credit.
      void queryClient.invalidateQueries({ queryKey: queryKeys.analysisJob(userId, "body_scan") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.checkInStatus(userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.credits(userId) });
    },
  };
}

export type ScanPressIds = ReturnType<typeof createScanPressIds>;

/**
 * The request id for each press. The id is held only while no answer has
 * come back for that photo; a different photo is always a new request.
 */
export function createScanPressIds(mint: () => string = () => crypto.randomUUID()) {
  let held: { id: string; photo: string } | null = null;
  return {
    idFor(photo: string): string {
      if (held && held.photo === photo) return held.id;
      held = { id: mint(), photo };
      return held.id;
    },
    /** An answer arrived: the next press is a new request. */
    answered(): void {
      held = null;
    },
    /** The photo whose answer was lost, for "Try again". */
    heldPhoto(): string | null {
      return held?.photo ?? null;
    },
  };
}

function isBodyType(value: unknown): value is BodyType {
  return typeof value === "string" && (BODIES as readonly string[]).includes(value);
}

/** The silhouette a stored body scan result carries, or null. */
export function bodyScanSilhouette(result: unknown): BodyType | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return null;
  const silhouette = (result as { silhouette?: unknown }).silhouette;
  return isBodyType(silhouette) ? silhouette : null;
}

/** What her own press answered, in this mount. */
export type BodyScanLocal =
  | { kind: "suggested"; silhouette: BodyType; jobId: string | null }
  | { kind: "failed"; code: string | null }
  | { kind: "lost" };

export type BodyScanPressOutcome =
  BodyScanLocal | { kind: "busy" } | { kind: "out-of-credits" } | { kind: "unavailable" };

/** One press: the size guard, the double-press guard, the id, the call and what it means. */
export async function sendBodyScanPress(args: {
  photo: string;
  ids: ScanPressIds;
  isBusy: () => boolean;
  mutate: (variables: BodyScanVariables) => Promise<BodyScanResult>;
}): Promise<BodyScanPressOutcome> {
  if (args.photo.length > BODY_SCAN_MAX_PHOTO_CHARS) {
    return { kind: "failed", code: BODY_SCAN_CODES.PHOTO_TOO_LARGE };
  }
  if (args.isBusy()) return { kind: "busy" };
  const clientRequestId = args.ids.idFor(args.photo);
  let answer: BodyScanResult;
  try {
    answer = await args.mutate({ bodyImageBase64: args.photo, clientRequestId });
  } catch (error) {
    if (isLostBodyScanAnswer(error)) return { kind: "lost" };
    args.ids.answered();
    return { kind: "failed", code: isBodyScanInFlight(error) ? BODY_SCAN_STILL_FINISHING : null };
  }
  args.ids.answered();
  if (!answer || typeof answer !== "object") return { kind: "failed", code: null };
  if (answer.success) {
    return isBodyType(answer.silhouette)
      ? { kind: "suggested", silhouette: answer.silhouette, jobId: answer.jobId ?? null }
      : { kind: "failed", code: null };
  }
  if (answer.error === INSUFFICIENT_CREDITS) return { kind: "out-of-credits" };
  if (answer.error === BODY_SCAN_CODES.UNAVAILABLE) return { kind: "unavailable" };
  return { kind: "failed", code: answer.error ?? null };
}

export type BodyScanView =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "suggested"; silhouette: BodyType; jobId: string | null }
  | {
      phase: "failed";
      failure: BodyScanFailure;
      jobId: string | null;
      /** No answer came back: "Try again" resends the same photo with the same id. */
      retrySame: boolean;
    };

const IDLE: BodyScanView = { phase: "idle" };
const READING: BodyScanView = { phase: "reading" };

/** A Postgres timestamp in ms, fractions beyond milliseconds cut first. */
function timeOf(value: string | null): number {
  if (!value) return Number.NaN;
  return Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
}

function rowView(
  state: AnalysisJobState | undefined,
  input: { now: number; dismissed: readonly string[]; clearedAt: number | null },
  ctx: { sameLocalDay?: (a: number, b: number) => boolean },
): BodyScanView | null {
  if (state?.status !== "ready" || !state.job) return null;
  const row = state.job;
  const offer = analysisJobOffer(row, {
    now: input.now,
    dismissedIds: input.dismissed,
    resultParses: (result) => bodyScanSilhouette(result) !== null,
    sameLocalDay: ctx.sameLocalDay,
  });
  // A stale row is reaped by the hook; until then it is still "reading".
  if (offer === "running" || offer === "stale") return READING;
  if (offer !== "ready" && offer !== "failed") return null;
  // She already cleared the answer this row came from.
  if (input.clearedAt !== null) {
    const finished = timeOf(row.completedAt ?? row.createdAt);
    if (Number.isFinite(finished) && finished <= input.clearedAt + CLEARED_SKEW_MS) return null;
  }
  if (offer === "ready") {
    const silhouette = bodyScanSilhouette(row.result);
    return silhouette ? { phase: "suggested", silhouette, jobId: row.id } : null;
  }
  return {
    phase: "failed",
    failure: describeBodyScanError(row.errorCode),
    jobId: row.id,
    retrySame: false,
  };
}

/**
 * What the silhouette step shows for her scan right now: her own press first
 * (pending, then its answer), then her latest `body_scan` job row (Wave D
 * plan, 3.5: body scans use only the dismiss rule; choosing a result also
 * dismisses it).
 */
export function bodyScanView(
  input: {
    pending: boolean;
    local: BodyScanLocal | null;
    job: AnalysisJobState | undefined;
    now: number;
    dismissed: readonly string[];
    clearedAt: number | null;
  },
  ctx: { sameLocalDay?: (a: number, b: number) => boolean } = {},
): BodyScanView {
  if (input.pending) return READING;
  const { local } = input;
  if (local?.kind === "suggested") {
    if (!local.jobId || !input.dismissed.includes(local.jobId)) {
      return { phase: "suggested", silhouette: local.silhouette, jobId: local.jobId };
    }
  }
  if (local?.kind === "failed") {
    return {
      phase: "failed",
      failure: describeBodyScanError(local.code),
      jobId: null,
      retrySame: false,
    };
  }
  const fromRow = rowView(input.job, input, ctx);
  if (fromRow) return fromRow;
  if (local?.kind === "lost") {
    return { phase: "failed", failure: describeBodyScanError(null), jobId: null, retrySame: true };
  }
  return IDLE;
}

/** Dismissed analysis job ids (all three kinds share it), newest 20 (Wave D plan, 3.5). */
export const ANALYSIS_DISMISSED_STORAGE_KEY = "mila:analysis-dismissed";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDismissedScans(storage: () => StorageLike | null = browserStorage): string[] {
  try {
    const raw = storage()?.getItem(ANALYSIS_DISMISSED_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Adds `id` (newest last) and stores the list; `known` keeps ids a failing store lost. */
export function rememberDismissedScan(
  id: string,
  storage: () => StorageLike | null = browserStorage,
  known: readonly string[] = [],
): string[] {
  const stored = readDismissedScans(storage);
  const merged = [...stored, ...known.filter((existing) => !stored.includes(existing))];
  const next = rememberDismissed(merged, id);
  try {
    storage()?.setItem(ANALYSIS_DISMISSED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full store: the hook's state still remembers it.
  }
  return next;
}

/** Stale jobs this tab already asked the server to reap. */
const reapedJobs = new Set<string>();

export type BodyScanController = ReturnType<typeof useBodyScan>;

export function useBodyScan(
  userId: string | undefined,
  options: { enabled?: boolean; onOutOfCredits?: () => void } = {},
) {
  const queryClient = useQueryClient();
  const runScan = useServerFn(runBodyScan);
  const reap = useServerFn(reapMyGenerationJobs);
  const latestReap = useRef(reap);
  latestReap.current = reap;
  const onOutOfCredits = useRef(options.onOutOfCredits);
  onOutOfCredits.current = options.onOutOfCredits;

  const mutation = useMutation(
    bodyScanMutationOptions(
      (variables) => runScan({ data: variables }) as Promise<BodyScanResult>,
      queryClient,
      userId,
    ),
  );
  const mutate = useRef(mutation.mutateAsync);
  mutate.current = mutation.mutateAsync;

  // Any mount's press still in flight (the mutation cache outlives the page).
  // src: https://tanstack.com/query/v5/docs/framework/react/reference/useIsMutating · 5.101.2
  const pending = useIsMutating({ mutationKey: BODY_SCAN_MUTATION_KEY }) > 0;
  const enabled = !!userId && (options.enabled ?? true);
  const jobQuery = useQuery({ ...latestAnalysisJobQueryOptions(userId, "body_scan"), enabled });

  const [ids] = useState(() => createScanPressIds());
  const [local, setLocal] = useState<BodyScanLocal | null>(null);
  const [clearedAt, setClearedAt] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissedScans());
  const [refusedUnavailable, setRefusedUnavailable] = useState(false);

  const jobState = enabled ? jobQuery.data : undefined;
  const now = Date.now();
  const view = bodyScanView({ pending, local, job: jobState, now, dismissed, clearedAt });

  // A row still "running" well past its deadline died with its server: ask
  // for it to be failed and refunded, once per job per tab, then read again.
  const row = jobState?.status === "ready" ? jobState.job : null;
  const staleJobId = row && analysisJobOffer(row, { now }) === "stale" ? row.id : null;
  useEffect(() => {
    if (!staleJobId || !userId || reapedJobs.has(staleJobId)) return;
    reapedJobs.add(staleJobId);
    void latestReap
      .current()
      .catch(() => null)
      .finally(() => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.analysisJob(userId, "body_scan"),
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.credits(userId) });
      });
  }, [staleJobId, userId, queryClient]);

  const start = useCallback(
    async (photo: string) => {
      const outcome = await sendBodyScanPress({
        photo,
        ids,
        isBusy: () => queryClient.isMutating({ mutationKey: BODY_SCAN_MUTATION_KEY }) > 0,
        mutate: (variables) => mutate.current(variables),
      });
      switch (outcome.kind) {
        case "busy":
          return;
        case "out-of-credits":
          setLocal(null);
          onOutOfCredits.current?.();
          return;
        case "unavailable":
          setLocal(null);
          setRefusedUnavailable(true);
          return;
        default:
          setLocal(outcome);
      }
    },
    [ids, queryClient],
  );

  /** She chose, kept or dismissed what is shown: it is not offered again. */
  const resolve = useCallback(() => {
    const jobId = view.phase === "suggested" || view.phase === "failed" ? view.jobId : null;
    if (jobId) setDismissed((known) => rememberDismissedScan(jobId, undefined, known));
    setLocal(null);
    setClearedAt(Date.now());
  }, [view]);

  /** After a lost answer, the same photo again (same id); otherwise back to the start. */
  const retry = useCallback(() => {
    const photo = view.phase === "failed" && view.retrySame ? ids.heldPhoto() : null;
    if (photo) {
      setLocal(null);
      void start(photo);
      return;
    }
    resolve();
  }, [view, ids, start, resolve]);

  return {
    view,
    /** The server said the scan is not available yet (the migration is missing). */
    refusedUnavailable,
    start,
    resolve,
    retry,
  };
}
