import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { renderAppMarkup } from "../../tests/helpers/render-app-markup";
import {
  createFeatureClock,
  createReapGate,
  featureJobKeys,
  parseFeatureJobRow,
  type FeatureJobState,
} from "@/lib/queries/feature-jobs";
import { featureJobView, reapStaleJob, useFeatureJob } from "./use-feature-job";

const USER = "user-1";
const NOW = new Date(2026, 9, 7, 13, 0, 0).getTime();

function job(overrides: Record<string, unknown> = {}) {
  const parsed = parseFeatureJobRow({
    id: "job-1",
    kind: "dupe_search",
    client_request_id: "req-1",
    status: "running",
    credit_state: "charged",
    result: null,
    error_code: null,
    input: {},
    deadline_at: new Date(NOW - 5 * 60_000).toISOString(),
    created_at: new Date(NOW - 10 * 60_000).toISOString(),
    completed_at: null,
    ...overrides,
  });
  if (!parsed) throw new Error("fixture row did not parse");
  return parsed;
}

function recordingClient() {
  const invalidated: unknown[] = [];
  const client = {
    invalidateQueries: (filters: { queryKey: unknown }) => {
      invalidated.push(filters.queryKey);
      return Promise.resolve();
    },
  } as unknown as QueryClient;
  return { client, invalidated };
}

describe("featureJobView", () => {
  test("migration missing: unavailable, no job, offer null, no label", () => {
    const view = featureJobView({ status: "unavailable" }, { now: NOW, dismissed: [] });
    expect(view).toEqual({ available: false, job: null, offer: null, label: null });
  });

  test("still loading counts as available with no offer", () => {
    expect(featureJobView(undefined, { now: NOW, dismissed: [] })).toEqual({
      available: true,
      job: null,
      offer: null,
      label: null,
    });
  });

  test("the offer is judged at the moment given, not at an earlier one", () => {
    const state: FeatureJobState = {
      status: "ready",
      job: job({ deadline_at: new Date(NOW + 60_000).toISOString() }),
    };
    expect(featureJobView(state, { now: NOW, dismissed: [] }).offer).toBe("running");
    expect(featureJobView(state, { now: NOW + 60_000 + 45_001, dismissed: [] }).offer).toBe(
      "stale",
    );
  });

  test("a stale row the server still sees alive reads as running", () => {
    const state: FeatureJobState = { status: "ready", job: job() };
    expect(featureJobView(state, { now: NOW, dismissed: [] }).offer).toBe("stale");
    expect(featureJobView(state, { now: NOW, dismissed: [], isAlive: () => true }).offer).toBe(
      "running",
    );
  });

  test("a dismissed row is not offered", () => {
    const state: FeatureJobState = {
      status: "ready",
      job: job({
        status: "succeeded",
        completed_at: new Date(NOW - 60_000).toISOString(),
      }),
    };
    expect(featureJobView(state, { now: NOW, dismissed: [] }).offer).toBe("ready");
    expect(featureJobView(state, { now: NOW, dismissed: ["job-1"] }).offer).toBeNull();
  });

  test("a result from yesterday carries its label", () => {
    const state: FeatureJobState = {
      status: "ready",
      job: job({
        status: "succeeded",
        completed_at: new Date(2026, 9, 6, 23, 58).toISOString(),
      }),
    };
    const view = featureJobView(state, {
      now: new Date(2026, 9, 7, 0, 5).getTime(),
      dismissed: [],
    });
    expect(view.label).toBe("From last night, 11:58 PM");
  });
});

describe("featureJobView across a long-open tab", () => {
  test("midnight: the same row is re-judged and gains its label", () => {
    const state: FeatureJobState = {
      status: "ready",
      job: job({ status: "succeeded", completed_at: new Date(2026, 9, 6, 23, 58).toISOString() }),
    };
    const before = featureJobView(state, {
      now: new Date(2026, 9, 6, 23, 59).getTime(),
      dismissed: [],
    });
    const after = featureJobView(state, {
      now: new Date(2026, 9, 7, 0, 5).getTime(),
      dismissed: [],
    });
    expect([before.offer, before.label]).toEqual(["ready", null]);
    expect([after.offer, after.label]).toEqual(["ready", "From last night, 11:58 PM"]);
  });

  test("the 12 h edge: offered at 12 h, gone 1 ms later (different day)", () => {
    const completed = new Date(2026, 9, 5, 14, 0).getTime();
    const state: FeatureJobState = {
      status: "ready",
      job: job({ status: "succeeded", completed_at: new Date(completed).toISOString() }),
    };
    const edge = 12 * 3_600_000;
    expect(featureJobView(state, { now: completed + edge, dismissed: [] }).offer).toBe("ready");
    expect(featureJobView(state, { now: completed + edge + 1, dismissed: [] }).offer).toBeNull();
  });

  test("a device 2 min ahead: no early stale, so no wasted reap", () => {
    const serverNow = NOW;
    const clock = createFeatureClock(() => serverNow + 120_000);
    clock.learn(new Date(serverNow - 10_000).toISOString(), serverNow + 120_000 - 10_000, "j");
    expect(clock.skew()).toBe(-120_000);
    // Deadline was 20 s ago on the server: still inside the 45 s allowance.
    const state: FeatureJobState = {
      status: "ready",
      job: job({ deadline_at: new Date(serverNow - 20_000).toISOString() }),
    };
    const deviceNow = serverNow + 120_000;
    expect(featureJobView(state, { now: deviceNow, dismissed: [] }).offer).toBe("stale");
    expect(featureJobView(state, { now: clock.now(deviceNow), dismissed: [] }).offer).toBe(
      "running",
    );
  });
});

describe("reapStaleJob", () => {
  test("a stale row is reaped once per job, then rows and credits are refetched", async () => {
    const gate = createReapGate(() => NOW);
    const { client, invalidated } = recordingClient();
    let calls = 0;
    const reap = async () => {
      calls += 1;
      return { available: true, reaped: 1 };
    };
    await reapStaleJob({ jobId: "job-1", userId: USER, reap, gate, queryClient: client });
    await reapStaleJob({ jobId: "job-1", userId: USER, reap, gate, queryClient: client });
    expect(calls).toBe(1);
    expect(invalidated).toContainEqual(["generation-jobs", USER]);
    expect(invalidated).toContainEqual(["credits", USER]);
    expect(invalidated).toHaveLength(2);
  });

  test("a refused or failed reap refetches nothing", async () => {
    const gate = createReapGate(() => NOW);
    const { client, invalidated } = recordingClient();
    await reapStaleJob({
      jobId: "job-1",
      userId: USER,
      reap: async () => {
        throw new Error("offline");
      },
      gate,
      queryClient: client,
    });
    expect(invalidated).toEqual([]);
  });

  test("a reap that found nothing marks the job alive", async () => {
    const gate = createReapGate(() => NOW);
    const { client } = recordingClient();
    await reapStaleJob({
      jobId: "job-1",
      userId: USER,
      reap: async () => ({ available: true, reaped: 0 }),
      gate,
      queryClient: client,
    });
    expect(gate.isAlive("job-1")).toBe(true);
  });
});

function Probe({ kind }: { kind: "dupe_search" }) {
  const { available, job, offer } = useFeatureJob(USER, kind, { now: () => NOW });
  return <p>{JSON.stringify({ available, job: job?.id ?? null, offer })}</p>;
}

describe("useFeatureJob", () => {
  test("migration missing: no polling, offer null", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(featureJobKeys.latest(USER, "dupe_search"), {
      status: "unavailable",
    } satisfies FeatureJobState);
    const html = await renderAppMarkup(<Probe kind="dupe_search" />, { userId: USER, queryClient });
    expect(html).toContain("&quot;available&quot;:false");
    expect(html).toContain("&quot;offer&quot;:null");
  });

  test("a cached finished row renders as ready", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(featureJobKeys.latest(USER, "dupe_search"), {
      status: "ready",
      job: job({
        status: "succeeded",
        completed_at: new Date(NOW - 60_000).toISOString(),
        result: { a: 1 },
      }),
    } satisfies FeatureJobState);
    const html = await renderAppMarkup(<Probe kind="dupe_search" />, { userId: USER, queryClient });
    expect(html).toContain("&quot;offer&quot;:&quot;ready&quot;");
  });
});
