import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { queryKeys } from "@/constants/query-keys";
import {
  CLOCK_SKEW_MS,
  REAP_GRACE_MS,
  featureJobOffer,
  featureOfferLabel,
  type FeatureJobKind,
  type FeatureJobOffer,
} from "@/lib/feature-job-offer";
import { reapMyGenerationJobs } from "@/lib/generation-jobs.functions";
import {
  REAP_ALIVE_MS,
  featureClock,
  featureDismissals,
  onFeaturePageReturn,
  featureJobKeys,
  featureReapGate,
  latestFeatureJobQueryOptions,
  reapOnce,
  type FeatureJob,
  type FeatureJobState,
  type ReapAnswer,
  type ReapGate,
} from "@/lib/queries/feature-jobs";

export type FeatureJobView = {
  /** False while the generation_jobs migration is missing: nothing is offered. */
  available: boolean;
  job: FeatureJob | null;
  offer: FeatureJobOffer | null;
  /** "From last night, 11:58 PM" for a result from before today, else null. */
  label: string | null;
};

/**
 * What her latest job of one kind means at `now`. The caller reads the clock
 * when it renders, never at mount. A stale row the server still sees alive
 * (`isAlive`, after a reap that found nothing) counts as running.
 */
export function featureJobView(
  state: FeatureJobState | undefined,
  ctx: { now: number; dismissed: readonly string[]; isAlive?: (jobId: string) => boolean },
): FeatureJobView {
  if (state?.status === "unavailable") {
    return { available: false, job: null, offer: null, label: null };
  }
  const job = state?.status === "ready" ? state.job : null;
  if (!job) return { available: true, job: null, offer: null, label: null };
  let offer = featureJobOffer(job, { now: ctx.now, dismissed: ctx.dismissed });
  if (offer === "stale" && ctx.isAlive?.(job.id)) offer = "running";
  return {
    available: true,
    job,
    offer,
    label:
      offer === "ready" || offer === "empty" || offer === "failed"
        ? featureOfferLabel(job, ctx.now)
        : null,
  };
}

/**
 * Reaps one stale job (at most once per job per 30 s, three per tab), then
 * refreshes her rows and credits. Answers null when nothing was asked.
 */
export async function reapStaleJob(args: {
  jobId: string;
  userId: string;
  reap: () => Promise<ReapAnswer>;
  queryClient: QueryClient;
  gate?: ReapGate;
}): Promise<ReapAnswer | null> {
  const answer = await reapOnce(args.jobId, args.reap, args.gate ?? featureReapGate);
  if (!answer) return null;
  void args.queryClient.invalidateQueries({ queryKey: featureJobKeys.all(args.userId) });
  void args.queryClient.invalidateQueries({ queryKey: queryKeys.credits(args.userId) });
  return answer;
}

/**
 * Follows her latest Lens, Dupe, Concierge or item-detection job: running,
 * ready, empty (refunded), failed, or nothing. The offer is decided with
 * `Date.now()` read in render, and the hook re-renders when a running row
 * crosses its stale line or she comes back to the tab, so a tab left open
 * overnight never judges by the time it was opened.
 *
 * - Credits are refetched when the row moves from running to anything else.
 * - A stale row is reaped (see reapStaleJob), then rows and credits refetch.
 * - While the migration is missing: no polling, no offer, no label.
 */
export function useFeatureJob(
  userId: string | undefined,
  kind: FeatureJobKind,
  options: { enabled?: boolean; inFlight?: boolean; now?: () => number } = {},
) {
  // The server's time now, read at each decision (render, poll, wake timer).
  const nowOverride = useRef(options.now);
  nowOverride.current = options.now;
  const now = useCallback(() => (nowOverride.current ?? featureClock.now)(), []);
  const queryClient = useQueryClient();
  const reap = useServerFn(reapMyGenerationJobs);
  const latestReap = useRef(reap);
  latestReap.current = reap;
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((n) => n + 1), []);

  const query = useQuery(
    latestFeatureJobQueryOptions(userId, kind, {
      enabled: options.enabled,
      inFlight: options.inFlight,
      now,
      isAlive: (jobId) => featureReapGate.isAlive(jobId),
    }),
  );
  const view = featureJobView(query.data, {
    now: now(),
    dismissed: userId ? featureDismissals.get(userId) : [],
    isAlive: (jobId) => featureReapGate.isAlive(jobId),
  });
  const { job, offer } = view;

  // Credits: a running row that settled may have refunded or kept the charge.
  const lastStatus = useRef<{ id: string; status: string } | null>(null);
  useEffect(() => {
    const before = lastStatus.current;
    lastStatus.current = job ? { id: job.id, status: job.status } : null;
    if (
      before &&
      job &&
      before.id === job.id &&
      before.status === "running" &&
      job.status !== "running"
    ) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.credits(userId) });
    }
  }, [job, userId, queryClient]);

  // Stale: ask the server to fail and refund it, once per job.
  const jobId = job?.id;
  useEffect(() => {
    if (offer !== "stale" || !jobId || !userId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void reapStaleJob({ jobId, userId, reap: () => latestReap.current(), queryClient }).then(
      (answer) => {
        // Found nothing to reap: the server still sees it alive. Judge again once that lapses.
        if (answer?.available && answer.reaped === 0) {
          timer = setTimeout(rerender, REAP_ALIVE_MS + 100);
        }
      },
    );
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [offer, jobId, userId, queryClient, rerender]);

  // A running row turns stale by the clock alone: wake up when it does.
  const deadlineAt = job?.deadline_at;
  useEffect(() => {
    if (offer !== "running" || !deadlineAt) return;
    const staleAt = Date.parse(deadlineAt) + REAP_GRACE_MS + CLOCK_SKEW_MS;
    if (!Number.isFinite(staleAt)) return;
    const wait = Math.min(Math.max(staleAt - now(), 0) + 100, 2_147_000_000);
    const timer = setTimeout(rerender, wait);
    return () => clearTimeout(timer);
  }, [offer, deadlineAt, rerender, now]);

  // Coming back to the tab judges again with the clock as it is now.
  useEffect(() => {
    return onFeaturePageReturn(typeof window === "undefined" ? null : window, rerender);
  }, [rerender]);

  const dismiss = useCallback(
    (id: string | undefined = jobId) => {
      if (!userId || !id) return;
      featureDismissals.add(userId, id);
      rerender();
    },
    [userId, jobId, rerender],
  );

  return { ...view, dismiss };
}
