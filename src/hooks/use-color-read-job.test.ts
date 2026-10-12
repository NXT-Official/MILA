import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { SEASON_HEX_MATRIX, SEASONS_MASTER_DATA } from "@/constants/style-profile";
import { ANALYSIS_POLL_MS } from "@/lib/analysis-job-offer";
import { parseAnalysisJobRow, type AnalysisJobState } from "@/lib/queries/analysis-jobs";
import { COLOR_READ_STALE_BUNDLE } from "@/lib/color-read-errors";
import { TimeoutError } from "@/lib/utils";
import { renderAppMarkup } from "../../tests/helpers/render-app-markup";
import { fakeMemberSession } from "../../tests/helpers/fake-member-supabase";
import {
  COLOR_READ_CLIENT_TIMEOUT_MS,
  COLOR_READ_ROW_WAIT_MS,
  ColorReadLostAnswerError,
  colorReadData,
  colorReadJobQueryOptions,
  colorReadJobView,
  colorReadPollMs,
  createAnalysisDismissals,
  createColorReadRequest,
  guardColorReadFetch,
  parseStoredColorRead,
  runColorRead,
  runningColorReadJob,
  useColorReadJob,
  type AnalyzeColorFn,
} from "./use-color-read-job";

const USER = "user-1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Pinned: 7 Oct 2026, 13:00 local. */
const NOW = new Date(2026, 9, 7, 13, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const sameDay = () => true;
const otherDay = () => false;

const PROFILE = {
  ...SEASONS_MASTER_DATA.AUTUMN_DEEP,
  faceShape: "Oval Frame",
  bodyType: "Hourglass",
  stylistNote: "Your features carry real depth. Rich, warm colors meet it.",
  fullPalette: SEASON_HEX_MATRIX.AUTUMN_DEEP,
  detectedLighting: "Ideal Daylight",
  calculatedUndertone: "True Warm",
  confidenceScore: 88,
  hairColor: "Dark brown",
  skinDepth: "Medium",
};

const TELEMETRY = {
  pass1Raw: {
    ambientLighting: "clear_daylight",
    biologicalUndertone: "warm_gold",
    computedContrast: "high",
  },
  interceptTriggered: false,
  gatekeeperNotes: [],
  pass2OverrideInputs: {
    ambientLighting: "clear_daylight",
    biologicalUndertone: "warm_gold",
    computedContrast: "high",
    sensorClippingEvent: false,
  },
  forcedDiagnostic: false,
};

const STORED = { profile: PROFILE, telemetry: TELEMETRY };

function job(overrides: Record<string, unknown> = {}) {
  const parsed = parseAnalysisJobRow({
    id: "job-1",
    kind: "color_read",
    client_request_id: "req-1",
    status: "succeeded",
    credit_state: "charged",
    result: STORED,
    error_code: null,
    deadline_at: iso(NOW - 10 * MIN + 300_000),
    created_at: iso(NOW - 10 * MIN),
    completed_at: iso(NOW - 9 * MIN),
    ...overrides,
  });
  if (!parsed) throw new Error("fixture row did not parse");
  return parsed;
}

const ready = (overrides: Record<string, unknown> = {}): AnalysisJobState => ({
  status: "ready",
  job: job(overrides),
});

const running = (deadlineFromNow = 4 * MIN, overrides: Record<string, unknown> = {}) =>
  ready({
    status: "running",
    result: null,
    completed_at: null,
    created_at: iso(NOW - MIN),
    deadline_at: iso(NOW + deadlineFromNow),
    ...overrides,
  });

// ---------------------------------------------------------------------------
// The press: one request, one id
// ---------------------------------------------------------------------------

describe("createColorReadRequest", () => {
  test("every press is a new request with its own id", () => {
    const first = createColorReadRequest({ imageBase64: "AAAA", mimeType: "image/jpeg" });
    const second = createColorReadRequest({ imageBase64: "AAAA", mimeType: "image/jpeg" });
    expect(first.id).toMatch(UUID);
    expect(second.id).toMatch(UUID);
    expect(first.id).not.toBe(second.id);
  });

  test("the request carries its photo and whether it is the tricky-light sample", () => {
    const request = createColorReadRequest(
      { imageBase64: "BBBB", mimeType: "image/png", stressTest: true },
      () => "fixed-id",
    );
    expect(request).toEqual({
      id: "fixed-id",
      imageBase64: "BBBB",
      mimeType: "image/png",
      stressTest: true,
    });
  });
});

describe("colorReadData", () => {
  test("sends the request's own id as clientRequestId", () => {
    const request = createColorReadRequest({ imageBase64: "CCCC", mimeType: "image/jpeg" });
    const data = colorReadData(request);
    expect(data.clientRequestId).toBe(request.id);
    expect(data.imageBase64).toBe("CCCC");
    expect(data.diagnostics).toBeUndefined();
  });

  test("the tricky-light sample forces a backlit, high-contrast calibration", () => {
    const data = colorReadData(
      createColorReadRequest({ imageBase64: "CCCC", mimeType: "image/jpeg", stressTest: true }),
    );
    expect(data.diagnostics).toEqual({
      forceCalibration: {
        ambientLighting: "backlit",
        biologicalUndertone: "cool_blue",
        computedContrast: "high",
      },
    });
  });
});

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

describe("runColorRead", () => {
  const request = createColorReadRequest(
    { imageBase64: "DDDD", mimeType: "image/jpeg" },
    () => "11111111-1111-4111-8111-111111111111",
  );

  test("a read comes back with its job id, sent under the request's id", async () => {
    const sent: unknown[] = [];
    const analyze: AnalyzeColorFn = async (options) => {
      sent.push(options);
      return { success: true, profile: PROFILE as never, telemetry: TELEMETRY, jobId: "job-9" };
    };
    const outcome = await runColorRead(analyze, request);
    expect(outcome).toEqual({
      kind: "read",
      profile: PROFILE as never,
      telemetry: TELEMETRY,
      jobId: "job-9",
    });
    expect((sent[0] as { data: { clientRequestId: string } }).data.clientRequestId).toBe(
      request.id,
    );
    // Every call goes through the guarded fetch, so a gateway page is a lost answer.
    expect(typeof (sent[0] as { fetch?: unknown }).fetch).toBe("function");
  });

  test("a read from the legacy path (no job) answers a null job id", async () => {
    const outcome = await runColorRead(
      async () => ({ success: true, profile: PROFILE as never, telemetry: TELEMETRY }),
      request,
    );
    expect(outcome.kind === "read" && outcome.jobId).toBeNull();
  });

  test("waits 175 seconds, then reads as lost, never as a failure", async () => {
    expect(COLOR_READ_CLIENT_TIMEOUT_MS).toBe(175_000);
    const limits: number[] = [];
    const outcome = await runColorRead(() => new Promise(() => {}), request, {
      withTimeout: (_promise, ms) => {
        limits.push(ms);
        return Promise.reject(new TimeoutError());
      },
    });
    expect(limits).toEqual([175_000]);
    expect(outcome).toEqual({ kind: "lost" });
  });

  test("Mila's own refusal is a refusal with its code", async () => {
    const outcome = await runColorRead(
      async () => ({ success: false, error: "INSUFFICIENT_CREDITS" }),
      request,
    );
    expect(outcome).toEqual({ kind: "refused", code: "INSUFFICIENT_CREDITS" });
  });

  test("a gateway page, a dropped connection or a foreign body is a lost answer", async () => {
    const thrown = [
      new ColorReadLostAnswerError(502),
      new TypeError("Failed to fetch"),
      new TypeError("NetworkError when attempting to fetch resource."),
    ];
    for (const error of thrown) {
      const outcome = await runColorRead(() => Promise.reject(error), request);
      expect(outcome).toEqual({ kind: "lost" });
    }
    // A 200 JSON body that is not Mila's answer is returned as the result by Start.
    const foreign = await runColorRead(async () => ({ ok: true }) as never, request);
    expect(foreign).toEqual({ kind: "lost" });
  });

  test("a tab left open across a deploy never reached the read: it is asked to refresh", async () => {
    const outcome = await runColorRead(
      () => Promise.reject(new Error("Server function info not found for abc123")),
      request,
    );
    expect(outcome).toEqual({ kind: "refused", code: COLOR_READ_STALE_BUNDLE });
  });

  test("an error Mila's server threw is a refusal, not a lost answer", async () => {
    const outcome = await runColorRead(
      () => Promise.reject(new Error("Unauthorized: No token provided")),
      request,
    );
    expect(outcome).toEqual({ kind: "refused", code: "Unauthorized: No token provided" });
  });
});

describe("guardColorReadFetch", () => {
  const answer =
    (status: number, headers: Record<string, string> = {}) =>
    async () =>
      new Response("<html>502 Bad Gateway</html>", { status, headers });

  test("a non-OK answer the app server did not write is a lost answer", async () => {
    const guarded = guardColorReadFetch(answer(502, { "content-type": "text/html" }));
    const error = await guarded("https://example.test/_serverFn/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ColorReadLostAnswerError);
    expect((error as Error).name).toBe("LostAnswerError");
  });

  test("Mila's own answers pass through, refusals included", async () => {
    const serialized = guardColorReadFetch(answer(500, { "x-tss-serialized": "true" }));
    expect((await serialized("https://example.test/")).status).toBe(500);
    const ok = guardColorReadFetch(answer(200));
    expect((await ok("https://example.test/")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// The stored read
// ---------------------------------------------------------------------------

describe("parseStoredColorRead", () => {
  test("reads the profile and telemetry a color_read job keeps", () => {
    const read = parseStoredColorRead(STORED);
    expect(read?.profile.subSeason).toBe(PROFILE.subSeason);
    expect(read?.profile.hairColor).toBe("Dark brown");
    expect(read?.profile.skinDepth).toBe("Medium");
    expect(read?.telemetry.gatekeeperNotes).toEqual([]);
  });

  test("hair that could not be seen stays null; an off-list value is dropped, never guessed", () => {
    expect(
      parseStoredColorRead({ ...STORED, profile: { ...PROFILE, hairColor: null } })?.profile
        .hairColor,
    ).toBeNull();
    const renamed = parseStoredColorRead({
      ...STORED,
      profile: { ...PROFILE, hairColor: "Teal", skinDepth: "Olive" },
    });
    expect(renamed).not.toBeNull();
    expect(renamed?.profile.hairColor).toBeUndefined();
    expect(renamed?.profile.skinDepth).toBeUndefined();
  });

  test("anything that is not a whole read is refused", () => {
    expect(parseStoredColorRead(null)).toBeNull();
    expect(parseStoredColorRead([STORED])).toBeNull();
    expect(parseStoredColorRead("read")).toBeNull();
    expect(parseStoredColorRead({ profile: PROFILE })).toBeNull();
    expect(parseStoredColorRead({ ...STORED, profile: { ...PROFILE, season: "Monsoon" } })).toBe(
      null,
    );
    expect(
      parseStoredColorRead({ ...STORED, profile: { ...PROFILE, primarySwatches: [] } }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// What her latest color read means now
// ---------------------------------------------------------------------------

describe("colorReadJobView", () => {
  const view = (
    state: AnalysisJobState | undefined,
    ctx: Partial<Parameters<typeof colorReadJobView>[1]> = {},
  ) => colorReadJobView(state, { now: NOW, sameLocalDay: sameDay, ...ctx });

  test("a missing table is unavailable and offers nothing", () => {
    expect(view({ status: "unavailable" })).toEqual({
      available: false,
      job: null,
      offer: null,
      read: null,
    });
  });

  test("before the first read answers there is nothing to offer", () => {
    expect(view(undefined).offer).toBeNull();
    expect(view(undefined).available).toBe(true);
  });

  test("a running read is still reading until 30 s past its deadline", () => {
    expect(view(running()).offer).toBe("running");
    const overdue = running(-31_000);
    // Past the reaper's line: still reading while the reap is asked for...
    expect(view(overdue).offer).toBe("running");
    // ...and failed once the reap has answered.
    expect(view(overdue, { reapSettled: () => true }).offer).toBe("failed");
    // A reap that found nothing means the server still sees it alive.
    expect(view(overdue, { reapSettled: () => true, isAlive: () => true }).offer).toBe("running");
  });

  test("a succeeded read is ready once, with the read it stored", () => {
    const result = view(ready());
    expect(result.offer).toBe("ready");
    expect(result.read?.profile.subSeason).toBe(PROFILE.subSeason);
  });

  test("never her saved read, a dismissed one, or one older than a read she saved since", () => {
    expect(view(ready(), { usedJobId: "job-1" }).offer).toBeNull();
    expect(view(ready(), { dismissed: ["job-1"] }).offer).toBeNull();
    expect(view(ready(), { appliedAt: iso(NOW - 5 * MIN) }).offer).toBeNull();
    // A quiz she saved before the read finished does not hide it.
    expect(view(ready(), { appliedAt: iso(NOW - 30 * MIN) }).offer).toBe("ready");
  });

  test("a read is offered within 12 hours, or on her local day, and not after", () => {
    const old = ready({ created_at: iso(NOW - 13 * HOUR), completed_at: iso(NOW - 13 * HOUR) });
    expect(view(old, { sameLocalDay: otherDay }).offer).toBeNull();
    expect(view(old, { sameLocalDay: sameDay }).offer).toBe("ready");
    const recent = ready({ completed_at: iso(NOW - 11 * HOUR) });
    expect(view(recent, { sameLocalDay: otherDay }).offer).toBe("ready");
  });

  test("a failed read is offered as failed; a delivered one never is", () => {
    expect(
      view(ready({ status: "failed", result: null, error_code: "deadline_exceeded" })).offer,
    ).toBe("failed");
    expect(
      view(ready({ status: "failed", result: null, error_code: "persist_failed_delivered" })).offer,
    ).toBeNull();
  });

  test("a stored read that no longer parses is never offered as ready", () => {
    expect(view(ready({ result: { profile: { season: "Autumn" } } })).offer).toBeNull();
  });

  describe("following one request after its answer was lost", () => {
    const follow = { requestId: "req-1", since: NOW - 5_000 };

    test("its own row decides: running, ready, failed", () => {
      expect(view(running(), { follow }).offer).toBe("running");
      expect(view(ready(), { follow }).offer).toBe("ready");
      expect(
        view(ready({ status: "failed", result: null, error_code: "ANALYSIS_PARSING_FAILED" }), {
          follow,
        }).offer,
      ).toBe("failed");
    });

    test("its own fresh read is offered even if an earlier id was dismissed or saved", () => {
      expect(view(ready(), { follow, dismissed: ["job-0"], usedJobId: "job-0" }).offer).toBe(
        "ready",
      );
    });

    test("with no row of its own yet it waits, then reads as lost (Try again keeps the id)", () => {
      const other = ready({ client_request_id: "req-other", id: "job-0" });
      expect(view(other, { follow }).offer).toBe("running");
      expect(view({ status: "ready", job: null }, { follow }).offer).toBe("running");
      const late = { requestId: "req-1", since: NOW - COLOR_READ_ROW_WAIT_MS - 1 };
      expect(view(other, { follow: late }).offer).toBe("lost");
      expect(view({ status: "ready", job: null }, { follow: late }).offer).toBe("lost");
    });

    test("its own row that cannot be shown reads as lost, so Try again replays it", () => {
      expect(view(ready({ result: { nope: true } }), { follow }).offer).toBe("lost");
    });
  });
});

describe("colorReadPollMs", () => {
  const poll = (
    state: AnalysisJobState | undefined,
    ctx: Partial<Parameters<typeof colorReadPollMs>[1]> = {},
  ) => colorReadPollMs(state, { now: NOW, follow: null, ...ctx });

  test("every 3 seconds while a read is running, never once it is over or overdue", () => {
    expect(ANALYSIS_POLL_MS).toBe(3_000);
    expect(poll(running())).toBe(3_000);
    expect(poll(running(-31_000))).toBe(false);
    expect(poll(running(-31_000), { isAlive: () => true })).toBe(3_000);
    expect(poll(ready())).toBe(false);
    expect(poll({ status: "unavailable" })).toBe(false);
    expect(poll({ status: "ready", job: null })).toBe(false);
  });

  test("while a lost request's row is awaited, only inside the wait", () => {
    const empty: AnalysisJobState = { status: "ready", job: null };
    expect(poll(empty, { follow: { requestId: "req-9", since: NOW - 1_000 } })).toBe(3_000);
    expect(
      poll(empty, { follow: { requestId: "req-9", since: NOW - COLOR_READ_ROW_WAIT_MS - 1 } }),
    ).toBe(false);
  });
});

describe("runningColorReadJob", () => {
  test("names the read still running, and nothing for a finished or overdue one", () => {
    expect(runningColorReadJob(running(), NOW)?.clientRequestId).toBe("req-1");
    expect(runningColorReadJob(running(-31_000), NOW)).toBeNull();
    expect(runningColorReadJob(ready(), NOW)).toBeNull();
    expect(runningColorReadJob({ status: "unavailable" }, NOW)).toBeNull();
    expect(runningColorReadJob(undefined, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

describe("colorReadJobQueryOptions", () => {
  function hangingClient() {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit", "setHeader"])
      chain[method] = () => chain;
    chain.then = () => new Promise(() => {});
    return {
      auth: {
        getSession: async () => ({ data: { session: fakeMemberSession(USER, "t") }, error: null }),
      },
      from: () => chain,
    } as never;
  }

  test("shares D-W0's color_read key and refetches when she comes back", () => {
    const options = colorReadJobQueryOptions(USER);
    expect(options.queryKey).toEqual(queryKeys.analysisJob(USER, "color_read"));
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(colorReadJobQueryOptions(undefined).enabled).toBe(false);
  });

  test("every read is bounded: a read that hangs gives up", async () => {
    const queryClient = new QueryClient();
    const options = colorReadJobQueryOptions(USER, { client: hangingClient(), readTimeoutMs: 20 });
    const error = await queryClient
      .fetchQuery({ ...options, retry: false })
      .catch((e: unknown) => e);
    expect((error as Error).name).toBe("TimeoutError");
    queryClient.clear();
  });
});

// ---------------------------------------------------------------------------
// Dismissed ids
// ---------------------------------------------------------------------------

describe("analysis dismissals", () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      map,
      storage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => void map.set(key, value),
      },
    };
  }

  test("keeps her newest 20 ids under mila:analysis-dismissed, per member", () => {
    const { map, storage } = memoryStorage();
    const store = createAnalysisDismissals(() => storage);
    for (let i = 0; i < 25; i += 1) store.add(USER, `job-${i}`);
    store.add("user-2", "job-x");
    expect(store.get(USER)).toHaveLength(20);
    expect(store.get(USER)[19]).toBe("job-24");
    expect(store.get(USER)).not.toContain("job-0");
    expect(store.get("user-2")).toEqual(["job-x"]);
    expect([...map.keys()].every((key) => key.startsWith("mila:analysis-dismissed:"))).toBe(true);
  });

  test("blocked storage keeps the ids in memory for this tab", () => {
    const store = createAnalysisDismissals(() => ({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    }));
    store.add(USER, "job-1");
    expect(store.get(USER)).toEqual(["job-1"]);
  });
});

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

describe("useColorReadJob", () => {
  function Probe(props: { usedJobId?: string | null }) {
    const view = useColorReadJob(USER, { usedJobId: props.usedJobId, now: () => NOW });
    return createElement(
      "pre",
      null,
      JSON.stringify({ available: view.available, offer: view.offer }),
    );
  }

  async function probe(state: AnalysisJobState, usedJobId: string | null = null) {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.analysisJob(USER, "color_read"), state);
    const markup = await renderAppMarkup(createElement(Probe, { usedJobId }), {
      userId: USER,
      queryClient,
    });
    queryClient.clear();
    return JSON.parse(
      markup
        .replace(/^.*<pre>/s, "")
        .replace(/<\/pre>.*$/s, "")
        .replace(/&quot;/g, '"'),
    );
  }

  test("polls every 3 seconds while running; offers a succeeded read once within 12 hours unless it is her saved read or dismissed; unavailable when the table is missing", async () => {
    expect(colorReadPollMs(running(), { now: NOW, follow: null })).toBe(3_000);
    expect(await probe(running())).toEqual({ available: true, offer: "running" });
    expect(await probe(ready())).toEqual({ available: true, offer: "ready" });
    expect(await probe(ready(), "job-1")).toEqual({ available: true, offer: null });
    expect(await probe({ status: "unavailable" })).toEqual({ available: false, offer: null });
    expect(
      colorReadJobView(ready(), { now: NOW, dismissed: ["job-1"], sameLocalDay: sameDay }).offer,
    ).toBeNull();
    expect(
      colorReadJobView(ready({ completed_at: iso(NOW - 12 * HOUR - 1) }), {
        now: NOW,
        sameLocalDay: otherDay,
      }).offer,
    ).toBeNull();
  });
});
