import { useEffect, useRef, useState } from "react";
import { useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { queryKeys } from "@/constants/query-keys";
import { reapMyGenerationJobs } from "@/lib/generation-jobs.functions";
import {
  createStaleJobReaper,
  generationImageQueryOptions,
  generationJobKeys,
  generationReaps,
  jobJustSettled,
  latestGenerationJobQueryOptions,
  lookSavedQueryOptions,
  onPageReturn,
  pendingGenerationFilters,
  pendingGenerationOf,
  type ClientGenerationKind,
  type MemberGenerationJob,
} from "@/lib/queries/generation-jobs";

/**
 * Her latest generation_jobs row of one kind (see
 * latestGenerationJobQueryOptions): polls every 3 s while it genuinely runs
 * (by the server's clock, or confirmed alive by the reaper), every 10 s while
 * this page waits on its own call (`inFlight`), refetches on focus, remembers
 * a missing table for 5 minutes, and refreshes her credits the moment a
 * running row settles (a refund may have landed).
 */
export function useLatestGenerationJob(
  userId: string | undefined,
  kind: ClientGenerationKind,
  options: {
    inFlight: boolean;
    enabled?: boolean;
    serverNow?: () => number;
    isAlive?: (jobId: string) => boolean;
  },
) {
  const queryClient = useQueryClient();
  const query = useQuery(latestGenerationJobQueryOptions(userId, kind, options));
  const job = query.data?.status === "ready" ? query.data.job : null;
  const previous = useRef<MemberGenerationJob | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = job;
    if (jobJustSettled(before, job)) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.credits(userId) });
    }
  }, [job, userId, queryClient]);
  return query;
}

/**
 * This kind's generation calls still in flight, from ANY mount of the page:
 * the mutation cache outlives the route, so coming back mid-run finds them.
 */
export function usePendingGenerations<TVariables>(kind: ClientGenerationKind) {
  return useMutationState({
    filters: pendingGenerationFilters(kind),
    select: (mutation) => pendingGenerationOf<TVariables>(mutation),
  });
}

/** Whether she already saved the look about to come back (see fetchLookSaved). */
export function useLookSaved(
  userId: string | undefined,
  candidate: { jobId: string; look: DailyLookLike; since: string } | null,
) {
  return useQuery(lookSavedQueryOptions(userId, candidate));
}

type DailyLookLike = { outfit: { headline: string; description: string } };

/** A succeeded row's picture as a data URI (signed URL, read once). */
export function useGenerationImage(
  userId: string | undefined,
  job: MemberGenerationJob | null | undefined,
  enabled: boolean,
) {
  return useQuery(generationImageQueryOptions(userId, job, { enabled }));
}

/**
 * The page's reaper (see createStaleJobReaper): it calls
 * `reapMyGenerationJobs` for the jobs she is shown that died with their
 * server, with a bounded backoff, then refreshes her rows and balance. Its
 * `isAlive` tells the job queries which "overdue" jobs the server still sees
 * running. `reapMyGenerationJobs` only ever touches her own jobs and answers
 * `{ available: false }` while the migration is not applied. What it
 * remembers is the tab's (`generationReaps`, per job, session-stored), so
 * leaving the page and coming back never starts a job's count again.
 */
export function useStaleGenerationReaper(userId: string | undefined) {
  const queryClient = useQueryClient();
  const reap = useServerFn(reapMyGenerationJobs);
  const latest = useRef({ reap, queryClient, userId });
  latest.current = { reap, queryClient, userId };
  const [reaper] = useState(() =>
    createStaleJobReaper({
      reap: () => latest.current.reap(),
      afterReap: () => {
        const { queryClient: client, userId: id } = latest.current;
        void client.invalidateQueries({ queryKey: generationJobKeys.all(id) });
        void client.invalidateQueries({ queryKey: queryKeys.credits(id) });
      },
      memory: generationReaps,
    }),
  );
  return reaper;
}

/** Hands the rows she is shown to the reaper whenever they or the clock change. */
export function useReapStaleJobs(
  reaper: ReturnType<typeof createStaleJobReaper>,
  userId: string | undefined,
  jobs: Array<MemberGenerationJob | null | undefined>,
  serverNow: number,
) {
  // Up to four rows: her latest look, her own look behind a newer row (round
  // 4), her latest style sheet and portrait.
  const [first, second, third, fourth] = jobs;
  useEffect(() => {
    if (!userId) return;
    void reaper.consider([first, second, third, fourth], serverNow, Date.now());
  }, [reaper, userId, first, second, third, fourth, serverNow]);
}

/**
 * The time, re-read every `intervalMs` while `active` (stage copy, stale
 * checks), and whenever she comes back to the tab, running or not (NEW-I1):
 * a tab left open overnight never judges anything by the time it was opened.
 */
export function useNow(active: boolean, intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  useEffect(
    () => onPageReturn(typeof window === "undefined" ? null : window, () => setNow(Date.now())),
    [],
  );
  return now;
}

/**
 * True once `active` has stayed true for `ms` (NEW-M1): a wait the page shows
 * ("Checking your last look…") is bounded, even when the read behind it hangs.
 */
export function useLongerThan(active: boolean, ms: number): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    setOver(false);
    if (!active) return;
    const timer = setTimeout(() => setOver(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && over;
}
