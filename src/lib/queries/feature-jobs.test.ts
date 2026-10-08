import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createAvailabilityCache } from "@/lib/availability-cache";
import { memberQueryRetry } from "./member-query";
import { fakeMemberSession } from "../../../tests/helpers/fake-member-supabase";
import {
  DISMISSED_LIMIT,
  FEATURE_JOB_COLUMNS,
  REAP_MIN_GAP_MS,
  REAP_JOB_LIMIT,
  REAP_TAB_LIMIT,
  createDismissedStore,
  createFeatureClock,
  createFeaturePressKeys,
  learnFeatureClock,
  onFeaturePageReturn,
  createReapGate,
  featureJobKeys,
  featureMutationKey,
  featureMutationOptions,
  featureRequestKey,
  featureWaitCopy,
  fetchLatestFeatureJob,
  isLostAnswer,
  latestFeatureJobQueryOptions,
  parseFeatureJobRow,
  reapOnce,
  type FeatureJobState,
} from "./feature-jobs";

const USER = "user-1";
const OTHER = "user-2";
const TOKEN = "member-token";
/** The pinned clock every time-dependent test judges by; no test reads the wall clock. */
const PINNED = Date.UTC(2026, 9, 7, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

type Result = { data?: unknown; error?: { code?: string; message: string } | null };

/** Records every builder call and answers the awaited chain with `result`. */
function fakeClient(result: Result, session = fakeMemberSession(USER, TOKEN)) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "setHeader", "abortSignal"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(
      resolve,
      reject,
    );
  const client = {
    auth: { getSession: async () => ({ data: { session }, error: null }) },
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    },
  };
  return {
    client: client as never,
    calls,
    reads: () => calls.filter((c) => c[0] === "from").length,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    kind: "lens_analysis",
    client_request_id: "6f1c2d4e-0000-4000-8000-000000000001",
    status: "succeeded",
    credit_state: "charged",
    result: { overall_score: 80 },
    error_code: null,
    input: {
      imageUrl: "https://x.test/a.jpg",
      message: "hi",
      conversationId: "conv-1",
      post_id: "post-1",
    },
    deadline_at: iso(PINNED + 240_000),
    created_at: iso(PINNED - 60_000),
    completed_at: iso(PINNED),
    ...overrides,
  };
}

describe("parseFeatureJobRow", () => {
  test("keeps a feature row and reads its link from input", () => {
    const job = parseFeatureJobRow(row());
    expect(job?.kind).toBe("lens_analysis");
    expect(job?.link).toEqual({
      imageUrl: "https://x.test/a.jpg",
      message: "hi",
      conversationId: "conv-1",
      postId: "post-1",
    });
  });

  test("rejects every other kind and anything malformed", () => {
    for (const kind of ["look", "style_sheet", "color_read", "check_in", "body_scan", "nope"]) {
      expect(parseFeatureJobRow(row({ kind }))).toBeNull();
    }
    expect(parseFeatureJobRow(null)).toBeNull();
    expect(parseFeatureJobRow(row({ status: "weird" }))).toBeNull();
    expect(parseFeatureJobRow(row({ deadline_at: null }))).toBeNull();
  });

  test("a missing input gives an empty link, not a crash", () => {
    expect(parseFeatureJobRow(row({ input: null }))?.link).toEqual({
      imageUrl: null,
      message: null,
      conversationId: null,
      postId: null,
    });
  });
});

describe("keys", () => {
  test("keys share the generation-jobs prefix", () => {
    expect(featureJobKeys.latest(USER, "dupe_search").slice(0, 2)).toEqual([
      "generation-jobs",
      USER,
    ]);
    expect(featureJobKeys.latest(USER, "dupe_search")).toEqual([
      "generation-jobs",
      USER,
      "dupe_search",
    ]);
    expect(featureMutationKey("concierge")).toEqual(["generation", "concierge"]);
  });
});

describe("fetchLatestFeatureJob", () => {
  test("reads her newest row of the kind as her, bounded by a signal", async () => {
    const { client, calls } = fakeClient({ data: [row()] });
    const state = await fetchLatestFeatureJob(client, USER, "lens_analysis", `Bearer ${TOKEN}`);
    expect(state.status).toBe("ready");
    expect(calls).toContainEqual(["from", "generation_jobs"]);
    expect(calls).toContainEqual(["select", FEATURE_JOB_COLUMNS]);
    expect(calls).toContainEqual(["eq", "user_id", USER]);
    expect(calls).toContainEqual(["eq", "kind", "lens_analysis"]);
    expect(calls).toContainEqual(["limit", 1]);
    expect(calls).toContainEqual(["setHeader", "Authorization", `Bearer ${TOKEN}`]);
    expect(calls.some((c) => c[0] === "abortSignal" && c[1] instanceof AbortSignal)).toBe(true);
  });

  test("a missing table reads as unavailable", async () => {
    for (const code of ["PGRST205", "42P01", "42703"]) {
      const { client } = fakeClient({ error: { code, message: "missing" } });
      const state = await fetchLatestFeatureJob(client, USER, "concierge", "Bearer x");
      expect(state).toEqual({ status: "unavailable" });
    }
  });

  test("any other error throws so the last good row is kept", async () => {
    const { client } = fakeClient({ error: { code: "500", message: "boom" } });
    await expect(fetchLatestFeatureJob(client, USER, "concierge", "Bearer x")).rejects.toBeTruthy();
  });
});

describe("latestFeatureJobQueryOptions", () => {
  test("unavailable is remembered: one read across mounts and focus events for 5 minutes", async () => {
    let clock = 1_000;
    const availability = createAvailabilityCache(5 * 60_000, () => clock);
    const { client, reads } = fakeClient({ error: { code: "PGRST205", message: "missing" } });
    const make = () =>
      latestFeatureJobQueryOptions(USER, "dupe_search", {
        client,
        now: () => PINNED,
        availability,
      });
    for (let i = 0; i < 4; i += 1) {
      const qc = new QueryClient();
      const state = await qc.fetchQuery({ ...make(), staleTime: 0 });
      expect(state).toEqual({ status: "unavailable" });
    }
    expect(reads()).toBe(1);
    clock += 5 * 60_000 + 1;
    await new QueryClient().fetchQuery({ ...make(), staleTime: 0 });
    expect(reads()).toBe(2);
  });

  test("polls only while running, faster than idle while her call is in flight", () => {
    const { client } = fakeClient({});
    const options = latestFeatureJobQueryOptions(USER, "lens_analysis", {
      client,
      now: () => PINNED,
      inFlight: false,
    });
    const interval = options.refetchInterval as (q: unknown) => number | false;
    const live = (status: string, deadline: number, data?: FeatureJobState) =>
      interval({
        state: {
          data:
            data ??
            ({
              status: "ready",
              job: parseFeatureJobRow(
                row({
                  status,
                  completed_at: status === "running" ? null : iso(PINNED),
                  deadline_at: new Date(deadline).toISOString(),
                }),
              ),
            } satisfies FeatureJobState),
        },
      });
    expect(live("running", PINNED + 60_000)).toBe(3_000);
    expect(live("succeeded", PINNED + 60_000)).toBe(false);
    // Past deadline + grace + skew: stale, not polled.
    expect(live("running", PINNED - 120_000)).toBe(false);
    expect(live("running", 0, { status: "unavailable" })).toBe(false);

    const busy = latestFeatureJobQueryOptions(USER, "lens_analysis", {
      client,
      now: () => PINNED,
      inFlight: true,
    });
    const busyInterval = busy.refetchInterval as (q: unknown) => number | false;
    expect(busyInterval({ state: { data: undefined } })).toBe(10_000);
  });

  test("an overdue row the server still sees alive keeps polling", () => {
    const { client } = fakeClient({});
    const options = latestFeatureJobQueryOptions(USER, "lens_analysis", {
      client,
      isAlive: (id) => id === "job-1",
    });
    const interval = options.refetchInterval as (q: unknown) => number | false;
    const job = parseFeatureJobRow(
      row({
        status: "running",
        completed_at: null,
        deadline_at: new Date(PINNED - 120_000).toISOString(),
      }),
    );
    expect(interval({ state: { data: { status: "ready", job } } })).toBe(3_000);
  });

  test("idle staleTime is 60 s, running 0, unavailable 5 min; retry is the member policy", () => {
    const { client } = fakeClient({});
    const options = latestFeatureJobQueryOptions(USER, "lens_analysis", {
      client,
      now: () => PINNED,
    });
    const stale = options.staleTime as (q: unknown) => number;
    const ready = (job: unknown) => ({ state: { data: { status: "ready", job } } });
    expect(stale(ready(null))).toBe(60_000);
    expect(stale(ready(parseFeatureJobRow(row({ status: "running", completed_at: null }))))).toBe(
      0,
    );
    expect(stale({ state: { data: { status: "unavailable" } } })).toBe(5 * 60_000);
    expect(options.retry).toBe(memberQueryRetry);
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  test("enabled follows the option and the member", () => {
    const { client } = fakeClient({});
    expect(
      latestFeatureJobQueryOptions(USER, "concierge", { client, now: () => PINNED }).enabled,
    ).toBe(true);
    expect(
      latestFeatureJobQueryOptions(USER, "concierge", { client, now: () => PINNED, enabled: false })
        .enabled,
    ).toBe(false);
    expect(
      latestFeatureJobQueryOptions(undefined, "concierge", { client, now: () => PINNED }).enabled,
    ).toBe(false);
  });
});

describe("featureMutationOptions", () => {
  test("mutations never retry and never pause offline", () => {
    const options = featureMutationOptions<{ userId: string }, string>(
      "dupe_search",
      async () => "ok",
      new QueryClient(),
    );
    expect(options.retry).toBe(false);
    expect(options.networkMode).toBe("always");
    expect(options.mutationKey).toEqual(["generation", "dupe_search"]);
  });

  test("a settled call refreshes credits, her jobs and the extra keys", () => {
    const qc = new QueryClient();
    const seen: unknown[] = [];
    qc.invalidateQueries = ((filters: { queryKey: unknown }) => {
      seen.push(filters.queryKey);
      return Promise.resolve();
    }) as never;
    const options = featureMutationOptions<{ userId: string }, string>(
      "lens_analysis",
      async () => "ok",
      qc,
      [["outfits", USER]],
    );
    options.onSettled(undefined, null, { userId: USER });
    expect(seen).toContainEqual(["credits", USER]);
    expect(seen).toContainEqual(["generation-jobs", USER]);
    expect(seen).toContainEqual(["outfits", USER]);
  });
});

describe("press keys", () => {
  test("a press key is reused for the same fingerprint until retired, kept after a lost answer, separate per member", () => {
    let n = 0;
    const keys = createFeaturePressKeys(() => `id-${(n += 1)}`);
    const first = keys.keyFor(USER, "lens_analysis", "fp-a");
    // A lost answer retires nothing: the same press reuses its id.
    expect(keys.keyFor(USER, "lens_analysis", "fp-a")).toBe(first);
    expect(keys.keyFor(USER, "lens_analysis", "fp-b")).not.toBe(first);
    expect(keys.keyFor(OTHER, "lens_analysis", "fp-a")).not.toBe(first);
    expect(keys.keyFor(USER, "dupe_search", "fp-a")).not.toBe(first);
    // A real server answer retires it.
    keys.retire(USER, "lens_analysis", first);
    expect(keys.keyFor(USER, "lens_analysis", "fp-a")).not.toBe(first);
  });

  test("retiring another member's id changes nothing", () => {
    let n = 0;
    const keys = createFeaturePressKeys(() => `id-${(n += 1)}`);
    const mine = keys.keyFor(USER, "concierge", "fp");
    keys.retire(OTHER, "concierge", mine);
    expect(keys.keyFor(USER, "concierge", "fp")).toBe(mine);
  });

  test("the request key is stable across property order and ignores empties", () => {
    expect(featureRequestKey({ b: 1, a: [1, { y: 2, x: null }], c: undefined })).toBe(
      featureRequestKey({ a: [1, { x: null, y: 2 }], b: 1 }),
    );
    expect(featureRequestKey({ a: 1 })).not.toBe(featureRequestKey({ a: 2 }));
  });
});

describe("isLostAnswer", () => {
  test("timeouts, dropped connections and stale bundles are lost answers", () => {
    const timeout = new Error("Timed out");
    timeout.name = "TimeoutError";
    expect(isLostAnswer(timeout)).toBe(true);
    expect(isLostAnswer(new TypeError("Failed to fetch"))).toBe(true);
    expect(isLostAnswer(new Error("Load failed"))).toBe(true);
    expect(isLostAnswer(new Error("Server function info not found for abc"))).toBe(true);
  });

  test("a real server answer is not", () => {
    expect(isLostAnswer(new Error("Not enough credits"))).toBe(false);
    expect(isLostAnswer(null)).toBe(false);
  });
});

describe("dismissed ids", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      data,
    };
  }

  test("dismissed ids are kept per member, at most 30", () => {
    const storage = memoryStorage();
    const store = createDismissedStore(() => storage);
    for (let i = 0; i < DISMISSED_LIMIT + 5; i += 1) store.add(USER, `job-${i}`);
    store.add(OTHER, "other-job");
    const mine = store.get(USER);
    expect(DISMISSED_LIMIT).toBe(30);
    expect(mine).toHaveLength(30);
    expect(mine.at(-1)).toBe("job-34");
    expect(mine).not.toContain("job-0");
    expect(store.get(OTHER)).toEqual(["other-job"]);
    expect(storage.data.has(`mila:feature-jobs-dismissed:${USER}`)).toBe(true);
  });

  test("adding the same id twice keeps one copy", () => {
    const store = createDismissedStore(() => memoryStorage());
    store.add(USER, "a");
    store.add(USER, "b");
    store.add(USER, "a");
    expect(store.get(USER)).toEqual(["b", "a"]);
  });

  test("storage that throws falls back to memory", () => {
    const store = createDismissedStore(() => {
      throw new Error("blocked");
    });
    store.add(USER, "a");
    expect(store.get(USER)).toEqual(["a"]);
    expect(store.get(OTHER)).toEqual([]);
  });

  test("unreadable stored text is ignored", () => {
    const storage = memoryStorage();
    storage.data.set(`mila:feature-jobs-dismissed:${USER}`, "{not json");
    const store = createDismissedStore(() => storage);
    expect(store.get(USER)).toEqual([]);
  });
});

describe("featureWaitCopy", () => {
  test("says you can leave only when it is true", () => {
    const can = featureWaitCopy("lens_analysis", 5_000, { canLeave: true });
    const cannot = featureWaitCopy("lens_analysis", 5_000, { canLeave: false });
    expect(can.line).toContain("you can keep browsing");
    expect(cannot.line).not.toContain("you can");
    expect(can.stage).toBe("Analyzing your photo");
  });

  test("concierge says C1 verbatim when she can leave, a short line when not", () => {
    const can = featureWaitCopy("concierge", 5_000, { canLeave: true });
    expect(can.line).toBe("You can leave this page. Mila's reply will be here.");
    expect(can.stage).toBe("You can leave this page. Mila's reply will be here.");
    const cannot = featureWaitCopy("concierge", 5_000, { canLeave: false });
    expect(cannot.line).toBe("Mila is writing back");
  });

  test("dupe stages move on with time, with no dashes", () => {
    expect(featureWaitCopy("dupe_search", 0, { canLeave: true }).stage).toBe("Reading the piece");
    expect(featureWaitCopy("dupe_search", 20_000, { canLeave: true }).stage).toBe(
      "Searching the catalog",
    );
    const late = featureWaitCopy("dupe_search", 60_000, { canLeave: true });
    expect(late.stage).toBe("Ranking the closest pieces");
    expect(late.line).toContain("you can close this sheet");
    expect(late.line).not.toMatch(/[–—]/);
  });

  test("a negative elapsed time reads as the start", () => {
    expect(featureWaitCopy("item_detection", -5, { canLeave: false }).stage).toBe(
      "Finding the pieces",
    );
  });
});

describe("reapOnce", () => {
  test("a stale row is reaped 30 s apart, at most 3 per job; another job still gets its reap", async () => {
    let clock = 10_000;
    const gate = createReapGate(() => clock);
    let calls = 0;
    const reap = async () => {
      calls += 1;
      return { available: true, reaped: 1 };
    };
    expect(await reapOnce("a", reap, gate)).toEqual({ available: true, reaped: 1 });
    // Same job again right away: refused.
    expect(await reapOnce("a", reap, gate)).toBeNull();
    clock += REAP_MIN_GAP_MS - 1;
    expect(await reapOnce("a", reap, gate)).toBeNull();
    clock += 1;
    expect(await reapOnce("a", reap, gate)).not.toBeNull();
    clock += REAP_MIN_GAP_MS;
    expect(await reapOnce("a", reap, gate)).not.toBeNull();
    expect(calls).toBe(REAP_JOB_LIMIT);
    // Job a has spent its three, however long it waits.
    clock += 10 * REAP_MIN_GAP_MS;
    expect(await reapOnce("a", reap, gate)).toBeNull();
    // A different job is not starved by it.
    expect(await reapOnce("b", reap, gate)).not.toBeNull();
    expect(await reapOnce("c", reap, gate)).not.toBeNull();
    expect(calls).toBe(5);
  });

  test("a runaway ceiling of 12 reaps per tab stops a loop across many jobs", async () => {
    const gate = createReapGate(() => 1);
    let calls = 0;
    const reap = async () => {
      calls += 1;
      return { available: true, reaped: 1 };
    };
    for (let i = 0; i < REAP_TAB_LIMIT + 5; i += 1) await reapOnce(`job-${i}`, reap, gate);
    expect(REAP_TAB_LIMIT).toBe(12);
    expect(calls).toBe(12);
  });

  test("a failed call still counts, and its error is not thrown", async () => {
    const gate = createReapGate(() => 1);
    const result = await reapOnce(
      "a",
      async () => {
        throw new Error("offline");
      },
      gate,
    );
    expect(result).toBeNull();
    expect(await reapOnce("a", async () => ({ available: true, reaped: 0 }), gate)).toBeNull();
  });

  test("a reap that found nothing marks the job alive for 60 s", async () => {
    let clock = 1_000;
    const gate = createReapGate(() => clock);
    await reapOnce("a", async () => ({ available: true, reaped: 0 }), gate);
    expect(gate.isAlive("a")).toBe(true);
    clock += 60_000;
    expect(gate.isAlive("a")).toBe(false);
    expect(gate.isAlive("never")).toBe(false);
  });

  test("a reap that reaped something does not mark it alive", async () => {
    const gate = createReapGate(() => 1);
    await reapOnce("a", async () => ({ available: true, reaped: 1 }), gate);
    expect(gate.isAlive("a")).toBe(false);
  });

  test("the migration missing marks nothing alive", async () => {
    const gate = createReapGate(() => 1);
    await reapOnce("a", async () => ({ available: false, reaped: 0 }), gate);
    expect(gate.isAlive("a")).toBe(false);
  });
});

describe("the server clock seam", () => {
  const T = new Date(2026, 9, 7, 12, 0, 0).getTime();
  const created = (ms: number) => new Date(ms).toISOString();

  test("defaults to the device clock until it has learned", () => {
    const clock = createFeatureClock(() => 5_000);
    expect(clock.skew()).toBe(0);
    expect(clock.now()).toBe(5_000);
  });

  test("learns from a row whose id was sent exactly once, using created_at against the press", () => {
    const clock = createFeatureClock(() => T);
    const job = { id: "j1", client_request_id: "r1", created_at: created(T - 120_000) };
    expect(learnFeatureClock(clock, job, { id: "r1", at: T, sends: 1 })).toBe(true);
    expect(clock.skew()).toBe(-120_000);
    expect(clock.now()).toBe(T - 120_000);
  });

  test("teaches nothing when the id was sent twice, is unknown, or is another request", () => {
    const clock = createFeatureClock(() => T);
    const job = { id: "j1", client_request_id: "r1", created_at: created(T - 120_000) };
    expect(learnFeatureClock(clock, job, { id: "r1", at: T, sends: 2 })).toBe(false);
    expect(learnFeatureClock(clock, job, { id: "r1", at: T })).toBe(false);
    expect(learnFeatureClock(clock, job, { id: "other", at: T, sends: 1 })).toBe(false);
    expect(learnFeatureClock(clock, job, null)).toBe(false);
    expect(clock.skew()).toBe(0);
  });

  test("takes the median of the last 5 samples, one per row", () => {
    const clock = createFeatureClock(() => T);
    const skews = [0, 10_000, 20_000, 30_000, 40_000, 50_000];
    skews.forEach((skew, i) => clock.learn(created(T + skew), T, `row-${i}`));
    // The first sample fell out: median of 10k..50k.
    expect(clock.skew()).toBe(30_000);
    // The same row read again does not count twice.
    clock.learn(created(T + 50_000), T, "row-5");
    expect(clock.skew()).toBe(30_000);
  });
});

describe("onFeaturePageReturn", () => {
  function fakeTarget(visible = true) {
    const listeners = new Map<string, Set<() => void>>();
    const doc = { visibilityState: visible ? "visible" : "hidden" };
    const target = {
      document: doc,
      addEventListener: (type: string, fn: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)?.add(fn);
      },
      removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    };
    const fire = (type: string) => listeners.get(type)?.forEach((fn) => fn());
    return { target, fire, doc, listeners };
  }

  test("focus, pageshow, online and a visible tab wake it; a hidden tab does not", () => {
    const { target, fire, doc } = fakeTarget();
    let wakes = 0;
    const stop = onFeaturePageReturn(target as never, () => (wakes += 1));
    fire("focus");
    fire("pageshow");
    fire("online");
    fire("visibilitychange");
    expect(wakes).toBe(4);
    doc.visibilityState = "hidden";
    fire("visibilitychange");
    expect(wakes).toBe(4);
    stop();
    fire("focus");
    expect(wakes).toBe(4);
  });

  test("no window means nothing to listen to", () => {
    expect(() => onFeaturePageReturn(null, () => {})()).not.toThrow();
  });
});

describe("latestFeatureJobQueryOptions now seam", () => {
  test("a device 2 min ahead: the poll judges by the corrected clock, no early stale", () => {
    const { client } = fakeClient({});
    // Server deadline 20 s ago on the server clock = 140 s ago by a device 2 min ahead.
    const deadline = new Date(PINNED - 140_000).toISOString();
    const job = parseFeatureJobRow(
      row({ status: "running", completed_at: null, deadline_at: deadline }),
    );
    const state = { state: { data: { status: "ready", job } } };
    const raw = latestFeatureJobQueryOptions(USER, "lens_analysis", { client, now: () => PINNED });
    expect((raw.refetchInterval as (q: unknown) => unknown)(state)).toBe(false);
    const corrected = latestFeatureJobQueryOptions(USER, "lens_analysis", {
      client,
      now: () => PINNED - 120_000,
    });
    expect((corrected.refetchInterval as (q: unknown) => unknown)(state)).toBe(3_000);
    expect((corrected.staleTime as (q: unknown) => unknown)(state)).toBe(0);
  });
});
