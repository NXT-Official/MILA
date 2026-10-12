import { describe, expect, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { INSUFFICIENT_CREDITS } from "@/lib/credits";
import { parseAnalysisJobRow, type AnalysisJobState } from "@/lib/queries/analysis-jobs";
import { BODY_SCAN_CODES } from "@/lib/body-scan-errors";
import { TimeoutError } from "@/lib/utils";
import type { BodyScanResult } from "@/lib/check-in.functions";
import {
  ANALYSIS_DISMISSED_STORAGE_KEY,
  BODY_SCAN_MUTATION_KEY,
  bodyScanMutationOptions,
  bodyScanSilhouette,
  bodyScanView,
  createScanPressIds,
  readDismissedScans,
  rememberDismissedScan,
  sendBodyScanPress,
  type BodyScanVariables,
} from "./use-body-scan";

/**
 * useBodyScan is a thin wrapper over TanStack Query observers (useMutation =
 * MutationObserver, useIsMutating = the mutation cache, useQuery = the job
 * row). There is no DOM under bun:test, so these drive the same options and
 * the same press logic the hook uses, the way use-generation-jobs.test.ts does.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const PHOTO_A = "A".repeat(2048);
const PHOTO_B = "B".repeat(2048);
const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

function counter() {
  let n = 0;
  return () => `req-${++n}`;
}

function job(overrides: Record<string, unknown> = {}) {
  const parsed = parseAnalysisJobRow({
    id: "job-1",
    kind: "body_scan",
    client_request_id: "req-1",
    status: "succeeded",
    credit_state: "none",
    result: { silhouette: "Pear" },
    error_code: null,
    deadline_at: new Date(NOW + 240_000).toISOString(),
    created_at: new Date(NOW - 60_000).toISOString(),
    completed_at: new Date(NOW - 30_000).toISOString(),
    ...overrides,
  });
  if (!parsed) throw new Error("fixture row did not parse");
  return parsed;
}

const ready = (row: ReturnType<typeof job> | null): AnalysisJobState => ({
  status: "ready",
  job: row,
});

/** A press through the real mutation options, against a scripted server. */
function harness(answers: Array<() => Promise<BodyScanResult>>) {
  const client = new QueryClient();
  const sent: BodyScanVariables[] = [];
  const options = bodyScanMutationOptions(
    async (vars) => {
      sent.push(vars);
      const next = answers.shift();
      if (!next) throw new Error("no scripted answer");
      return next();
    },
    client,
    USER,
  );
  const observer = new MutationObserver(client, options);
  const ids = createScanPressIds(counter());
  const press = (photo: string) =>
    sendBodyScanPress({
      photo,
      ids,
      isBusy: () => client.isMutating({ mutationKey: BODY_SCAN_MUTATION_KEY }) > 0,
      mutate: (vars) => observer.mutate(vars),
    });
  return { client, sent, press, observer };
}

describe("useBodyScan", () => {
  test("one clientRequestId per press; re-attaches after remount; never retries", async () => {
    // One id per press: two answered presses send two ids.
    {
      const { client, sent, press } = harness([
        async () => ({ success: true, silhouette: "Pear", jobId: "job-1" }),
        async () => ({ success: false, error: BODY_SCAN_CODES.NOT_FULL_LENGTH }),
        async () => ({ success: true, silhouette: "Apple", jobId: "job-3" }),
      ]);
      expect(await press(PHOTO_A)).toEqual({
        kind: "suggested",
        silhouette: "Pear",
        jobId: "job-1",
      });
      expect(await press(PHOTO_A)).toEqual({
        kind: "failed",
        code: BODY_SCAN_CODES.NOT_FULL_LENGTH,
      });
      // A reported (refunded) failure mints a new id for the next press.
      await press(PHOTO_A);
      expect(sent.map((v) => v.clientRequestId)).toEqual(["req-1", "req-2", "req-3"]);
      expect(sent.every((v) => v.bodyImageBase64 === PHOTO_A)).toBe(true);
      client.clear();
    }

    // A double press while the first is still being read sends one request.
    {
      const server = deferred<BodyScanResult>();
      const { client, sent, press } = harness([() => server.promise]);
      const first = press(PHOTO_A);
      expect(await press(PHOTO_A)).toEqual({ kind: "busy" });
      server.resolve({ success: true, silhouette: "Pear", jobId: "job-1" });
      await first;
      expect(sent).toHaveLength(1);
      client.clear();
    }

    // A lost answer keeps the id for the same photo (it replays, never pays
    // twice); a different photo is a new request.
    {
      const { client, sent, press } = harness([
        async () => {
          throw new TimeoutError();
        },
        async () => {
          throw new TypeError("Failed to fetch");
        },
        async () => ({ success: true, silhouette: "Pear", jobId: "job-1" }),
        async () => ({ success: true, silhouette: "Apple", jobId: "job-2" }),
      ]);
      expect(await press(PHOTO_A)).toEqual({ kind: "lost" });
      expect(await press(PHOTO_A)).toEqual({ kind: "lost" });
      await press(PHOTO_A);
      await press(PHOTO_B);
      expect(sent.map((v) => v.clientRequestId)).toEqual(["req-1", "req-1", "req-1", "req-2"]);
      client.clear();
    }

    // Re-attaches after remount: she leaves mid-scan, the call stays pending
    // under its key, and the next mount finds it and shows "reading".
    {
      const server = deferred<BodyScanResult>();
      const { client, sent, press, observer } = harness([() => server.promise]);
      client.setQueryData(queryKeys.analysisJob(USER, "body_scan"), ready(null));
      client.setQueryData(queryKeys.checkInStatus(USER), { available: true });
      client.setQueryData(queryKeys.credits(USER), 3);
      const unsubscribe = observer.subscribe(() => {});
      const first = press(PHOTO_A);
      await flush();
      unsubscribe();

      const pendingOnRemount = client.isMutating({ mutationKey: BODY_SCAN_MUTATION_KEY }) > 0;
      expect(pendingOnRemount).toBe(true);
      expect(
        bodyScanView({
          pending: pendingOnRemount,
          local: null,
          job: ready(null),
          now: NOW,
          dismissed: [],
          clearedAt: null,
        }),
      ).toEqual({ phase: "reading" });
      expect(sent).toHaveLength(1);

      // The answer lands after she left: the hook-level onSettled still
      // refreshes her body scan row, her price and her credits, so the
      // remounted page offers the result from the job row.
      server.resolve({ success: true, silhouette: "Pear", jobId: "job-1" });
      await first;
      await flush();
      expect(client.isMutating({ mutationKey: BODY_SCAN_MUTATION_KEY })).toBe(0);
      expect(client.getQueryState(queryKeys.analysisJob(USER, "body_scan"))?.isInvalidated).toBe(
        true,
      );
      expect(client.getQueryState(queryKeys.checkInStatus(USER))?.isInvalidated).toBe(true);
      expect(client.getQueryState(queryKeys.credits(USER))?.isInvalidated).toBe(true);
      expect(
        bodyScanView({
          pending: false,
          local: null,
          job: ready(job()),
          now: NOW,
          dismissed: [],
          clearedAt: null,
        }),
      ).toEqual({ phase: "suggested", silhouette: "Pear", jobId: "job-1" });
      client.clear();
    }

    // Never retries on its own, and is never kept in the cache once settled.
    {
      const client = new QueryClient();
      const options = bodyScanMutationOptions(
        async () => ({ success: true }) as never,
        client,
        USER,
      );
      expect(options.retry).toBe(false);
      expect(options.gcTime).toBe(0);
      expect(options.mutationKey).toEqual(["body-scan"]);
      let attempts = 0;
      const failing = new MutationObserver(
        client,
        bodyScanMutationOptions(
          async () => {
            attempts += 1;
            throw new TypeError("Failed to fetch");
          },
          client,
          USER,
        ),
      );
      await failing.mutate({ bodyImageBase64: PHOTO_A, clientRequestId: "req-1" }).catch(() => {});
      expect(attempts).toBe(1);
      client.clear();
    }
  });

  test("out of credits, a missing migration and still finishing are told apart", async () => {
    const { client, sent, press } = harness([
      async () => ({ success: false, error: INSUFFICIENT_CREDITS }),
      async () => ({ success: false, error: BODY_SCAN_CODES.UNAVAILABLE }),
      async () => {
        const err = new Error("Mila is still finishing your last request. Try again in a moment.");
        err.name = "GenerationInFlightError";
        throw err;
      },
      async () => {
        throw new Error("Internal server error");
      },
    ]);
    expect(await press(PHOTO_A)).toEqual({ kind: "out-of-credits" });
    expect(await press(PHOTO_A)).toEqual({ kind: "unavailable" });
    expect(await press(PHOTO_A)).toEqual({ kind: "failed", code: "BODY_SCAN_STILL_FINISHING" });
    expect(await press(PHOTO_A)).toEqual({ kind: "failed", code: null });
    // Every one of these was an answer: each next press had a new id.
    expect(sent.map((v) => v.clientRequestId)).toEqual(["req-1", "req-2", "req-3", "req-4"]);
    client.clear();
  });

  test("a photo over the server's cap is refused before anything is sent", async () => {
    const { client, sent, press } = harness([]);
    expect(await press("x".repeat(1_800_001))).toEqual({
      kind: "failed",
      code: BODY_SCAN_CODES.PHOTO_TOO_LARGE,
    });
    expect(sent).toHaveLength(0);
    client.clear();
  });
});

describe("bodyScanView", () => {
  const base = {
    pending: false,
    local: null,
    job: ready(null),
    now: NOW,
    dismissed: [] as string[],
    clearedAt: null,
  };

  test("nothing to show: idle; a missing generation_jobs table shows nothing either", () => {
    expect(bodyScanView(base)).toEqual({ phase: "idle" });
    expect(bodyScanView({ ...base, job: { status: "unavailable" } })).toEqual({ phase: "idle" });
    expect(bodyScanView({ ...base, job: undefined })).toEqual({ phase: "idle" });
  });

  test("a running row reads as reading, and so does one past its deadline (it is reaped)", () => {
    const running = job({ status: "running", completed_at: null, result: null });
    expect(bodyScanView({ ...base, job: ready(running) })).toEqual({ phase: "reading" });
    const stale = job({
      status: "running",
      completed_at: null,
      result: null,
      deadline_at: new Date(NOW - 120_000).toISOString(),
    });
    expect(bodyScanView({ ...base, job: ready(stale) })).toEqual({ phase: "reading" });
  });

  test("a succeeded row is offered until she chooses or dismisses it", () => {
    expect(bodyScanView({ ...base, job: ready(job()) })).toEqual({
      phase: "suggested",
      silhouette: "Pear",
      jobId: "job-1",
    });
    expect(bodyScanView({ ...base, job: ready(job()), dismissed: ["job-1"] })).toEqual({
      phase: "idle",
    });
  });

  test("a succeeded row whose result is not a silhouette is never offered", () => {
    for (const result of [null, "Pear", ["Pear"], { silhouette: "Banana" }, {}]) {
      expect(bodyScanView({ ...base, job: ready(job({ result })) })).toEqual({ phase: "idle" });
    }
  });

  test("a failed row says what happened; a delivered-but-unsaved row never reads as failed", () => {
    const failed = job({
      status: "failed",
      result: null,
      error_code: BODY_SCAN_CODES.NOT_FULL_LENGTH,
    });
    const view = bodyScanView({ ...base, job: ready(failed) });
    expect(view.phase).toBe("failed");
    if (view.phase === "failed") {
      expect(view.jobId).toBe("job-1");
      expect(view.failure.offerQuiz).toBe(true);
      expect(view.retrySame).toBe(false);
    }
    const delivered = job({ status: "failed", error_code: "persist_failed_delivered" });
    expect(bodyScanView({ ...base, job: ready(delivered) })).toEqual({ phase: "idle" });
  });

  test("a row from yesterday morning is not offered tonight", () => {
    const old = job({
      completed_at: new Date(NOW - 20 * 3_600_000).toISOString(),
      created_at: new Date(NOW - 20 * 3_600_000).toISOString(),
    });
    expect(
      bodyScanView({ ...base, job: ready(old), now: NOW }, { sameLocalDay: () => false }),
    ).toEqual({ phase: "idle" });
  });

  test("her own press wins over the row: pending, then its answer", () => {
    const failedRow = job({ status: "failed", result: null, error_code: "BODY_SCAN_FAILED" });
    expect(bodyScanView({ ...base, pending: true, job: ready(failedRow) })).toEqual({
      phase: "reading",
    });
    expect(
      bodyScanView({
        ...base,
        local: { kind: "suggested", silhouette: "Apple", jobId: "job-2" },
        job: ready(failedRow),
      }),
    ).toEqual({ phase: "suggested", silhouette: "Apple", jobId: "job-2" });
    const failedView = bodyScanView({
      ...base,
      local: { kind: "failed", code: BODY_SCAN_CODES.RATE_LIMITED },
    });
    expect(failedView.phase).toBe("failed");
    if (failedView.phase === "failed") {
      expect(failedView.failure.message).toBe(
        "That's a lot of scans in a short while. Please try again later.",
      );
      expect(failedView.retrySame).toBe(false);
    }
  });

  test("a lost answer follows the row when there is one, else offers the same photo again", () => {
    const running = job({ status: "running", completed_at: null, result: null });
    expect(bodyScanView({ ...base, local: { kind: "lost" }, job: ready(running) })).toEqual({
      phase: "reading",
    });
    expect(bodyScanView({ ...base, local: { kind: "lost" }, job: ready(job()) })).toEqual({
      phase: "suggested",
      silhouette: "Pear",
      jobId: "job-1",
    });
    const lost = bodyScanView({ ...base, local: { kind: "lost" }, job: { status: "unavailable" } });
    expect(lost.phase).toBe("failed");
    if (lost.phase === "failed") expect(lost.retrySame).toBe(true);
  });

  test("once she has cleared her own answer, the row it came from is not offered again", () => {
    const failedRow = job({ status: "failed", result: null, error_code: "BODY_SCAN_FAILED" });
    expect(bodyScanView({ ...base, job: ready(failedRow), clearedAt: NOW })).toEqual({
      phase: "idle",
    });
    expect(bodyScanView({ ...base, job: ready(job()), clearedAt: NOW })).toEqual({
      phase: "idle",
    });
  });

  test("bodyScanSilhouette reads only a known silhouette", () => {
    expect(bodyScanSilhouette({ silhouette: "Inverted Triangle" })).toBe("Inverted Triangle");
    expect(bodyScanSilhouette({ silhouette: "not_visible" })).toBeNull();
    expect(bodyScanSilhouette(null)).toBeNull();
  });
});

describe("dismissed scans", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  }

  test("kept in the shared analysis list, newest 20, without duplicates", () => {
    const storage = memoryStorage();
    let ids: string[] = [];
    for (let i = 1; i <= 22; i += 1) ids = rememberDismissedScan(`job-${i}`, () => storage);
    ids = rememberDismissedScan("job-22", () => storage);
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe("job-3");
    expect(ids[19]).toBe("job-22");
    expect(JSON.parse(storage.data.get(ANALYSIS_DISMISSED_STORAGE_KEY) ?? "[]")).toEqual(ids);
    expect(readDismissedScans(() => storage)).toEqual(ids);
    expect(ANALYSIS_DISMISSED_STORAGE_KEY).toBe("mila:analysis-dismissed");
  });

  test("a broken, foreign or unreachable store reads as nothing dismissed and never throws", () => {
    expect(readDismissedScans(() => memoryStorage({ "mila:analysis-dismissed": "{" }))).toEqual([]);
    expect(
      readDismissedScans(() => memoryStorage({ "mila:analysis-dismissed": '{"a":1}' })),
    ).toEqual([]);
    expect(
      readDismissedScans(() => memoryStorage({ "mila:analysis-dismissed": '["a",2,"b"]' })),
    ).toEqual(["a", "b"]);
    expect(readDismissedScans(() => null)).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readDismissedScans(() => throwing)).toEqual([]);
    expect(rememberDismissedScan("job-1", () => throwing)).toEqual(["job-1"]);
  });
});
