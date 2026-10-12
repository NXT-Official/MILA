import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver, focusManager } from "@tanstack/react-query";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { TimeoutError } from "@/lib/utils";
import { MemberSessionUnavailableError, SESSION_UNAVAILABLE_CODE } from "@/lib/auth-session";
import { memberQueryRetry } from "@/lib/queries/member-query";
import {
  GENERATION_POLL_MS,
  IN_FLIGHT_POLL_MS,
  JOB_CHECK_TIMEOUT_MS,
  MAX_REAP_ATTEMPTS,
  PERSIST_FAILED_DELIVERED,
  REAP_BACKOFF_MS,
  UNAVAILABLE_RECHECK_MS,
  changedPressPlan,
  createPressCheck,
  createReapMemory,
  decideLookRecovery,
  deviceIsOffline,
  generationMutationOptions,
  learnServerClock,
  onPageReturn,
  readLatestJobWithin,
  askedForLook,
  fetchGenerationJobsByRequestIds,
  OWN_ROW_WAIT_MS,
  LostAnswerError,
  createLookMark,
  createTrackedJobs,
  guardGenerationFetch,
  isSessionRefusal,
  lookEventFor,
  lostAnswerNotice,
  settleLookForSave,
  answerAsked,
  confirmLookAsked,
  findCachedJob,
  lookAnswersPress,
  ownGenerationJobsQueryOptions,
  ownJobBehindLatest,
  ownPressesHold,
  ownRowsExpectedUntil,
  refusalRetires,
  readOwnJobsWithin,
  createGenerationRequestLedger,
  createJobsAvailability,
  createServerClock,
  createStaleJobReaper,
  fetchLatestGenerationJob,
  fetchLookSaved,
  isJobInProgress,
  isRecentLook,
  lookSavedQueryOptions,
  pressDecision,
  recoveredLookLabel,
  generationImageQueryOptions,
  generationJobKeys,
  generationJobPhase,
  generationMutationKey,
  generationRequestKey,
  generationFailureNotice,
  generationWaitCopy,
  isGenerationJobsMissing,
  isUnknownGenerationOutcome,
  jobIsForLook,
  latestGenerationJobQueryOptions,
  loadGenerationImage,
  lookToRecover,
  parseGenerationJobRow,
  styleSheetNeverDrawn,
  visualToRecover,
  type FetchLike,
  type MemberGenerationJob,
} from "./generation-jobs";
import { fakeMemberSession } from "../../../tests/helpers/fake-member-supabase";
import { fakeGenerationJobsClient } from "../../../tests/helpers/fake-generation-jobs-supabase";

const USER = "11111111-1111-4111-8111-111111111111";
const TOKEN = "member-token";
const NOW = Date.parse("2026-10-07T10:00:00Z");

const LOOK = {
  outfit: {
    headline: "Linen shirt and tailored shorts",
    description: "A light, breathable set for a warm day.",
    styling_notes: "Roll the sleeves once.",
  },
  hair: { style: "Loose waves", execution_tip: "Air dry, then diffuse." },
  makeup: null,
  vibe_alignment_score: 8,
  shoppable_picks: [],
  forecastRetrievedAt: null,
};

function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    user_id: USER,
    kind: "look",
    client_request_id: "22222222-2222-4222-8222-222222222222",
    status: "running",
    credit_state: "charged",
    result: null,
    image_path: null,
    error_code: null,
    input: {},
    deadline_at: new Date(NOW + 300_000).toISOString(),
    created_at: new Date(NOW - 5_000).toISOString(),
    completed_at: null,
    ...overrides,
  };
}

function job(overrides: Record<string, unknown> = {}): MemberGenerationJob {
  const parsed = parseGenerationJobRow(rawRow(overrides));
  if (!parsed) throw new Error("fixture row did not parse");
  return parsed;
}

function signedIn(rows: Record<string, unknown>[] = []) {
  return fakeGenerationJobsClient({ session: fakeMemberSession(USER, TOKEN), rows });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(check: () => boolean, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await flush();
}

afterEach(() => {
  focusManager.setFocused(undefined);
});

describe("reading her latest job of one kind", () => {
  test("asks for her own newest row of that kind, sent as her", async () => {
    const fake = signedIn([rawRow()]);
    const state = await fetchLatestGenerationJob(
      fake.client as never,
      USER,
      "look",
      `Bearer ${TOKEN}`,
    );
    expect(state.status).toBe("ready");
    expect(fake.requests).toHaveLength(1);
    const [request] = fake.requests;
    expect(request.table).toBe("generation_jobs");
    expect(request.filters).toEqual({ user_id: USER, kind: "look" });
    expect(request.order).toEqual({ column: "created_at", ascending: false });
    expect(request.limit).toBe(1);
    expect(request.authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("picks the newest row, parsed", async () => {
    const fake = signedIn([
      rawRow({ id: "old", created_at: "2026-10-07T08:00:00Z", status: "succeeded" }),
      rawRow({ id: "new", created_at: "2026-10-07T09:59:00Z" }),
      rawRow({ id: "sheet", kind: "style_sheet", created_at: "2026-10-07T09:59:30Z" }),
    ]);
    const state = await fetchLatestGenerationJob(fake.client as never, USER, "look", "Bearer x");
    expect(state).toMatchObject({ status: "ready", job: { id: "new", status: "running" } });
  });

  test("no rows yet is ready with no job", async () => {
    const fake = signedIn([]);
    const state = await fetchLatestGenerationJob(fake.client as never, USER, "look", "Bearer x");
    expect(state).toEqual({ status: "ready", job: null });
  });

  for (const code of ["PGRST205", "42P01", "42703"]) {
    test(`a missing migration (${code}) is "unavailable", never an error`, async () => {
      const fake = fakeGenerationJobsClient({
        session: fakeMemberSession(USER, TOKEN),
        error: { code, message: "relation does not exist" },
      });
      const state = await fetchLatestGenerationJob(fake.client as never, USER, "look", "Bearer x");
      expect(state).toEqual({ status: "unavailable" });
    });
  }

  test("any other failure throws, so the query keeps its last good row", async () => {
    const fake = fakeGenerationJobsClient({
      session: fakeMemberSession(USER, TOKEN),
      error: { code: "PGRST301", message: "JWT expired" },
    });
    await expect(
      fetchLatestGenerationJob(fake.client as never, USER, "look", "Bearer x"),
    ).rejects.toMatchObject({ code: "PGRST301" });
  });

  test("the fetch guard's refusal is not mistaken for a missing migration", async () => {
    const refusal = { code: SESSION_UNAVAILABLE_CODE, message: "You're reconnecting." };
    expect(isGenerationJobsMissing(refusal)).toBe(false);
    const fake = fakeGenerationJobsClient({
      session: fakeMemberSession(USER, TOKEN),
      error: refusal,
    });
    await expect(
      fetchLatestGenerationJob(fake.client as never, USER, "look", "Bearer x"),
    ).rejects.toMatchObject({ code: SESSION_UNAVAILABLE_CODE });
  });

  test("a row of an unknown status or shape is ignored rather than trusted", () => {
    expect(parseGenerationJobRow(rawRow({ status: "paused" }))).toBeNull();
    expect(parseGenerationJobRow({ id: 3 })).toBeNull();
    expect(parseGenerationJobRow(null)).toBeNull();
  });

  test("a sheet or portrait row remembers which look it was drawn for", () => {
    const sheet = job({ kind: "style_sheet", input: { outfit: LOOK } });
    expect(sheet.forLook).toEqual({
      headline: LOOK.outfit.headline,
      description: LOOK.outfit.description,
    });
    expect(jobIsForLook(sheet, LOOK)).toBe(true);
    expect(
      jobIsForLook(sheet, { ...LOOK, outfit: { ...LOOK.outfit, headline: "Another look" } }),
    ).toBe(false);
  });
});

describe("the latest-job query (what the dashboard hook runs)", () => {
  test("is keyed per member and kind, refetches on focus, retries through a reconnect", () => {
    const options = latestGenerationJobQueryOptions(USER, "style_sheet");
    expect(options.queryKey).toEqual(generationJobKeys.latest(USER, "style_sheet"));
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.retry).toBe(memberQueryRetry);
    expect(latestGenerationJobQueryOptions(undefined, "look").enabled).toBe(false);
    expect(latestGenerationJobQueryOptions(USER, "look", { enabled: false }).enabled).toBe(false);
  });

  test("polls every 3 s while her job is running, and stops once it settles", async () => {
    const fake = signedIn([rawRow()]);
    const client = new QueryClient();
    const observer = new QueryObserver(
      client,
      latestGenerationJobQueryOptions(USER, "look", {
        client: fake.client as never,
        availability: createJobsAvailability(),
        serverNow: () => NOW,
      }),
    );
    const unsubscribe = observer.subscribe(() => {});
    await until(() => observer.getCurrentResult().status === "success");
    const query = client.getQueryCache().find({ queryKey: generationJobKeys.latest(USER, "look") });
    const interval = observer.options.refetchInterval as (q: unknown) => number | false;
    expect(GENERATION_POLL_MS).toBe(3_000);
    expect(interval(query)).toBe(3_000);

    fake.setRows([rawRow({ status: "succeeded", completed_at: new Date(NOW).toISOString() })]);
    await observer.refetch();
    expect(interval(query)).toBe(false);
    unsubscribe();
    client.clear();
  });

  test("polls slowly (10 s) while her own call is in flight, even before a row exists (N3)", async () => {
    const fake = signedIn([]);
    const client = new QueryClient();
    const options = latestGenerationJobQueryOptions(USER, "look", {
      client: fake.client as never,
      availability: createJobsAvailability(),
      inFlight: true,
    });
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => {});
    await until(() => observer.getCurrentResult().status === "success");
    const query = client.getQueryCache().find({ queryKey: generationJobKeys.latest(USER, "look") });
    expect((options.refetchInterval as (q: unknown) => number | false)(query)).toBe(
      IN_FLIGHT_POLL_MS,
    );
    expect(IN_FLIGHT_POLL_MS).toBe(10_000);
    unsubscribe();
    client.clear();
  });

  test("a dead row (past deadline + grace on the server's clock) is not polled (M4)", async () => {
    const fake = signedIn([rawRow({ deadline_at: new Date(NOW - 60_000).toISOString() })]);
    const client = new QueryClient();
    const base = {
      client: fake.client as never,
      availability: createJobsAvailability(),
      serverNow: () => NOW,
    };
    const options = latestGenerationJobQueryOptions(USER, "look", base);
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => {});
    await until(() => observer.getCurrentResult().status === "success");
    const query = client.getQueryCache().find({ queryKey: generationJobKeys.latest(USER, "look") });
    expect((options.refetchInterval as (q: unknown) => number | false)(query)).toBe(false);
    // ... unless the server's own reaper said it is still alive.
    const alive = latestGenerationJobQueryOptions(USER, "look", { ...base, isAlive: () => true });
    expect((alive.refetchInterval as (q: unknown) => number | false)(query)).toBe(3_000);
    unsubscribe();
    client.clear();
  });

  test("a missing migration never polls", async () => {
    const fake = fakeGenerationJobsClient({
      session: fakeMemberSession(USER, TOKEN),
      error: { code: "PGRST205", message: "missing" },
    });
    const client = new QueryClient();
    const options = latestGenerationJobQueryOptions(USER, "look", {
      client: fake.client as never,
      availability: createJobsAvailability(),
    });
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => {});
    await until(() => observer.getCurrentResult().status === "success");
    expect(observer.getCurrentResult().data).toEqual({ status: "unavailable" });
    const query = client.getQueryCache().find({ queryKey: generationJobKeys.latest(USER, "look") });
    expect((options.refetchInterval as (q: unknown) => number | false)(query)).toBe(false);
    unsubscribe();
    client.clear();
  });

  test("a missing migration is read once, then not again on focus, remount or another kind for 5 minutes (M1)", async () => {
    let now = NOW;
    const availability = createJobsAvailability({ now: () => now });
    const fake = fakeGenerationJobsClient({
      session: fakeMemberSession(USER, TOKEN),
      error: { code: "PGRST205", message: "missing" },
    });
    const client = new QueryClient();
    client.mount();
    const options = (kind: "look" | "style_sheet") =>
      latestGenerationJobQueryOptions(USER, kind, { client: fake.client as never, availability });

    const first = new QueryObserver(client, options("look"));
    const stopFirst = first.subscribe(() => {});
    await until(() => first.getCurrentResult().status === "success");
    expect(fake.requests).toHaveLength(1);

    // She comes back to the tab three times.
    for (let i = 0; i < 3; i += 1) {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await flush();
    }
    // The page remounts, and the other kinds are asked too.
    stopFirst();
    const again = new QueryObserver(client, options("look"));
    const stopAgain = again.subscribe(() => {});
    const sheet = new QueryObserver(client, options("style_sheet"));
    const stopSheet = sheet.subscribe(() => {});
    await until(() => sheet.getCurrentResult().status === "success");
    expect(sheet.getCurrentResult().data).toEqual({ status: "unavailable" });
    expect(fake.requests).toHaveLength(1);

    // Five minutes later the table is asked about once more.
    now += UNAVAILABLE_RECHECK_MS + 1;
    await sheet.refetch();
    expect(fake.requests).toHaveLength(2);
    stopAgain();
    stopSheet();
    client.unmount();
    client.clear();
  });

  test("a refused read while she reconnects keeps the last good row on screen", async () => {
    const fake = signedIn([rawRow()]);
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } });
    client.mount();
    const observer = new QueryObserver(
      client,
      latestGenerationJobQueryOptions(USER, "look", {
        client: fake.client as never,
        availability: createJobsAvailability(),
      }),
    );
    const unsubscribe = observer.subscribe(() => {});
    await until(() => observer.getCurrentResult().status === "success");

    // Her refresh is failing: getSession() has no session right now.
    fake.setSession(null, new AuthRetryableFetchError("Failed to fetch", 0));
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await until(() => observer.getCurrentResult().failureCount > 0);

    const during = observer.getCurrentResult();
    expect(during.data).toMatchObject({ status: "ready", job: { id: "job-1" } });
    expect(during.status).toBe("success");
    expect(during.failureReason).toBeInstanceOf(MemberSessionUnavailableError);
    // Nothing went out without her token.
    expect(fake.requests.every((r) => r.authorization === `Bearer ${TOKEN}`)).toBe(true);
    unsubscribe();
    client.unmount();
    client.clear();
  });
});

describe("the server's clock (M3)", () => {
  test("is learned from her own row: a fast device clock no longer reads a fresh job as dead", () => {
    const clock = createServerClock();
    const deviceAhead = 6 * 60_000;
    const pressedAt = NOW + deviceAhead;
    clock.learn(new Date(NOW + 400).toISOString(), pressedAt);
    expect(clock.skew()).toBe(400 - deviceAhead);
    const fresh = job({ deadline_at: new Date(NOW + 300_000).toISOString() });
    expect(generationJobPhase(fresh, pressedAt)).toBe("stale");
    expect(generationJobPhase(fresh, clock.now(pressedAt))).toBe("running");
  });

  test("starts at no offset", () => {
    expect(createServerClock().now(NOW)).toBe(NOW);
  });

  test("reads the device clock at the moment it is asked, not when it was made", () => {
    let device = NOW;
    const clock = createServerClock({ deviceNow: () => device });
    clock.learn(new Date(NOW + 400).toISOString(), NOW, "job-1");
    device += 3 * 3_600_000;
    expect(clock.now()).toBe(NOW + 3 * 3_600_000 + 400);
  });
});

describe("the server's clock learns only from fresh press times (NEW-M2)", () => {
  const ownEntry = (overrides: Partial<{ id: string; at: number; sends: number }> = {}) => ({
    id: "22222222-2222-4222-8222-222222222222",
    key: "a",
    at: NOW,
    sends: 1,
    ...overrides,
  });

  test("a row created by a press sent once is a sample: created_at against that send", () => {
    const clock = createServerClock();
    const row = job({ created_at: new Date(NOW + 700).toISOString() });
    expect(learnServerClock(clock, row, ownEntry())).toBe(true);
    expect(clock.skew()).toBe(700);
  });

  test("a reused id's first press time is never a sample: which send made the row is unknown", () => {
    const clock = createServerClock();
    // Her first press never reached the server; the same press 6 minutes
    // later reused its id and made the row.
    const row = job({ created_at: new Date(NOW + 6 * 60_000 + 300).toISOString() });
    expect(learnServerClock(clock, row, ownEntry({ sends: 2 }))).toBe(false);
    expect(clock.skew()).toBe(0);
  });

  test("an entry from before send counts were kept is not trusted either", () => {
    const clock = createServerClock();
    const legacy = { id: "22222222-2222-4222-8222-222222222222", key: "a", at: NOW };
    expect(learnServerClock(clock, job(), legacy)).toBe(false);
    expect(clock.skew()).toBe(0);
  });

  test("another request's row teaches nothing", () => {
    const clock = createServerClock();
    expect(learnServerClock(clock, job(), ownEntry({ id: "someone-else" }))).toBe(false);
    expect(learnServerClock(clock, job(), null)).toBe(false);
  });

  test("the offset is the median of the last few samples, so one slow request cannot skew it", () => {
    const clock = createServerClock();
    clock.learn(new Date(NOW + 400).toISOString(), NOW, "job-1");
    clock.learn(new Date(NOW + 500).toISOString(), NOW, "job-2");
    // A request that sat in a slow upload for a minute.
    clock.learn(new Date(NOW + 60_000).toISOString(), NOW, "job-3");
    expect(clock.skew()).toBe(500);
  });

  test("the same row read again is one sample, not many", () => {
    const clock = createServerClock();
    for (let i = 0; i < 3; i += 1) clock.learn(new Date(NOW + 400).toISOString(), NOW, "job-1");
    clock.learn(new Date(NOW + 1_000).toISOString(), NOW, "job-2");
    expect(clock.skew()).toBe(700);
  });

  test("only the last five samples count", () => {
    const clock = createServerClock();
    clock.learn(new Date(NOW + 90_000).toISOString(), NOW, "old-1");
    clock.learn(new Date(NOW + 90_000).toISOString(), NOW, "old-2");
    for (let i = 0; i < 5; i += 1) {
      clock.learn(new Date(NOW + 200).toISOString(), NOW, `new-${i}`);
    }
    expect(clock.skew()).toBe(200);
  });
});

describe("a tab left open judges recovery by the time she returns (NEW-I1)", () => {
  // Local wall-clock times, so the day boundary is hers whatever zone the test runs in.
  const at = (month: number, day: number, hour: number, minute: number) =>
    new Date(2026, month - 1, day, hour, minute).getTime();
  const finishedAt = (completed: number) =>
    job({
      status: "succeeded",
      result: LOOK,
      created_at: new Date(completed - 120_000).toISOString(),
      completed_at: new Date(completed).toISOString(),
    });
  /** The page mounted at `mountedAt`, then sat idle: nothing ran, so nothing ticked. */
  function idlePage(mountedAt: number) {
    let device = mountedAt;
    const clock = createServerClock({ deviceNow: () => device });
    return {
      clock,
      /** The device clock moved on while the tab sat open; she comes back now. */
      returnAt: (time: number) => {
        device = time;
      },
    };
  }
  const decide = (row: MemberGenerationJob, clock: ReturnType<typeof createServerClock>) =>
    decideLookRecovery({
      job: row,
      shown: null,
      own: false,
      watched: false,
      lastPressAt: 0,
      clock,
    });

  test("mounted 23:50, a look finished 23:58, she returns at 00:02: it comes back labelled", () => {
    const page = idlePage(at(10, 7, 23, 50));
    const row = finishedAt(at(10, 7, 23, 58));
    page.returnAt(at(10, 8, 0, 2));
    expect(decide(row, page.clock)).toMatchObject({
      jobId: "job-1",
      fromLabel: "From last night, 11:58 PM",
    });
  });

  test("mounted yesterday 08:00, a phone look from 08:30 yesterday, she returns at 07:00: it stays in the past", () => {
    const page = idlePage(at(10, 7, 8, 0));
    const row = finishedAt(at(10, 7, 8, 30));
    page.returnAt(at(10, 8, 7, 0));
    expect(decide(row, page.clock)).toBeNull();
  });

  test("mounted 23:00, a phone look at 00:30, she returns at 01:00: it comes back, from today", () => {
    const page = idlePage(at(10, 7, 23, 0));
    const row = finishedAt(at(10, 8, 0, 30));
    page.returnAt(at(10, 8, 1, 0));
    expect(decide(row, page.clock)).toMatchObject({ jobId: "job-1", fromLabel: null });
  });

  test("her last press is compared on the same server clock", () => {
    let device = NOW;
    const clock = createServerClock({ deviceNow: () => device });
    // The device runs 10 minutes behind the server.
    clock.learn(new Date(NOW + 10 * 60_000).toISOString(), NOW, "job-0");
    const row = job({
      status: "succeeded",
      result: LOOK,
      created_at: new Date(NOW + 10 * 60_000 + 5_000).toISOString(),
      completed_at: new Date(NOW + 10 * 60_000 + 90_000).toISOString(),
    });
    device = NOW + 2 * 60_000;
    const ask = (lastPressAt: number) =>
      decideLookRecovery({ job: row, shown: null, own: false, watched: false, lastPressAt, clock });
    // Pressed (device time) just before the row was created (server time): it is newer.
    expect(ask(NOW + 1_000)).not.toBeNull();
    // Pressed after it was created: she chose to replace it.
    expect(ask(NOW + 60_000)).toBeNull();
  });
});

describe("coming back to the tab re-reads the time (NEW-I1)", () => {
  function page(visible = true) {
    const target = new EventTarget();
    const state = { visible };
    let returns = 0;
    const stop = onPageReturn(
      target,
      () => {
        returns += 1;
      },
      () => state.visible,
    );
    return { target, state, stop, returns: () => returns };
  }

  test("focus, a visible tab, a restored page and coming back online each count", () => {
    const p = page();
    for (const type of ["focus", "visibilitychange", "pageshow", "online"]) {
      p.target.dispatchEvent(new Event(type));
    }
    expect(p.returns()).toBe(4);
  });

  test("the tab being hidden does not", () => {
    const p = page(false);
    p.target.dispatchEvent(new Event("visibilitychange"));
    expect(p.returns()).toBe(0);
  });

  test("stops listening when the page goes", () => {
    const p = page();
    p.stop();
    p.target.dispatchEvent(new Event("focus"));
    expect(p.returns()).toBe(0);
  });

  test("no window (server render) is a no-op", () => {
    expect(() => onPageReturn(undefined, () => {})()).not.toThrow();
  });
});

describe("what a row means", () => {
  test("running inside its deadline + 30 s grace is running; past it, it is stale", () => {
    const running = job({ deadline_at: new Date(NOW + 1_000).toISOString() });
    expect(generationJobPhase(running, NOW)).toBe("running");
    expect(generationJobPhase(running, NOW + 31_000)).toBe("running");
    expect(generationJobPhase(running, NOW + 31_001)).toBe("stale");
  });

  test("persist_failed_delivered was delivered and charged: never a failure", () => {
    const delivered = job({ status: "failed", error_code: PERSIST_FAILED_DELIVERED });
    expect(generationJobPhase(delivered, NOW)).toBe("delivered");
    expect(generationJobPhase(job({ status: "failed", error_code: "render_failed" }), NOW)).toBe(
      "failed",
    );
    expect(generationJobPhase(job({ status: "succeeded" }), NOW)).toBe("succeeded");
  });
});

describe("which look comes back after she leaves and returns", () => {
  const succeeded = (overrides: Record<string, unknown> = {}) =>
    job({
      status: "succeeded",
      result: LOOK,
      input: { vibe: "Brunch", weather: "24°C Sunny (in Manila)" },
      completed_at: new Date(NOW - 60_000).toISOString(),
      created_at: new Date(NOW - 150_000).toISOString(),
      ...overrides,
    });
  const ask = (row: MemberGenerationJob, over: Partial<Parameters<typeof lookToRecover>[0]> = {}) =>
    lookToRecover({
      job: row,
      shown: null,
      own: false,
      watched: false,
      clearedAt: 0,
      now: NOW,
      ...over,
    });

  test("nothing on screen: her recent look is shown again", () => {
    const decision = ask(succeeded());
    expect(decision).toMatchObject({ jobId: "job-1", own: false });
    expect(decision?.look.outfit.headline).toBe(LOOK.outfit.headline);
  });

  test("it comes back with the vibe and weather it was asked for, as saving writes them (M2)", () => {
    expect(ask(succeeded())).toMatchObject({ vibe: "Brunch", weatherLabel: "24°C Sunny (Manila)" });
    expect(ask(succeeded({ input: {} }))).toMatchObject({ vibe: null, weatherLabel: null });
  });

  test("her own request that this page never heard back from always lands", () => {
    const row = succeeded({ created_at: new Date(NOW - 3 * 86_400_000).toISOString() });
    expect(ask(row, { own: true, clearedAt: NOW })).toMatchObject({ own: true, jobId: "job-1" });
  });

  test("a job this page showed as composing lands when it succeeds, whatever she pressed since (I1)", () => {
    expect(ask(succeeded(), { clearedAt: NOW - 10_000 })).toBeNull();
    expect(ask(succeeded(), { clearedAt: NOW - 10_000, watched: true })).toMatchObject({
      jobId: "job-1",
    });
    // ...but it never covers a look she is looking at.
    expect(ask(succeeded(), { watched: true, shown: { jobId: "job-0" } })).toBeNull();
  });

  test("her own job never swaps a look already on screen: it waits until the screen is clear (round 3)", () => {
    // Another device's look came onto the screen first; her own job is found after.
    expect(ask(succeeded({ id: "job-2" }), { own: true, shown: { jobId: "job-1" } })).toBeNull();
    // A look on screen with no job (composed here before jobs were live) is not swapped either.
    expect(ask(succeeded(), { own: true, shown: { jobId: null } })).toBeNull();
    // Once the screen is clear (her next press, or a reload), it lands.
    expect(ask(succeeded({ id: "job-2" }), { own: true, shown: null })).toMatchObject({
      own: true,
      jobId: "job-2",
    });
  });

  test("while a press of hers is unanswered, another device's look waits so hers can land first (round 3)", () => {
    expect(ask(succeeded(), { ownPending: true })).toBeNull();
    expect(ask(succeeded(), { ownPending: false })).toMatchObject({ jobId: "job-1" });
    // Her own job and a job this page showed as composing still land.
    expect(ask(succeeded(), { ownPending: true, own: true })).toMatchObject({ own: true });
    expect(ask(succeeded(), { ownPending: true, watched: true })).toMatchObject({ jobId: "job-1" });
  });

  test("the look already on screen is not shown twice", () => {
    expect(ask(succeeded(), { shown: { jobId: "job-1" } })).toBeNull();
    expect(ask(succeeded(), { shown: { jobId: "job-1" }, own: true })).toBeNull();
  });

  test("a look she is looking at is never swapped for someone else's newer job", () => {
    expect(ask(succeeded({ id: "job-2" }), { shown: { jobId: "job-1" } })).toBeNull();
  });

  test("a look she cleared by pressing Create does not come back unasked", () => {
    expect(ask(succeeded(), { clearedAt: NOW - 10_000 })).toBeNull();
  });

  test("an old look from another day stays in the past", () => {
    const old = succeeded({
      created_at: new Date(NOW - 2 * 86_400_000).toISOString(),
      completed_at: new Date(NOW - 2 * 86_400_000).toISOString(),
    });
    expect(ask(old)).toBeNull();
    // A watched or own job is hers from this page, whenever it finished.
    expect(ask(old, { watched: true })).not.toBeNull();
  });

  test("running, failed, delivered-but-unsaved and malformed rows are never shown as a look", () => {
    for (const row of [
      job(),
      job({ status: "failed", error_code: "deadline_exceeded", credit_state: "refunded" }),
      job({ status: "failed", error_code: PERSIST_FAILED_DELIVERED }),
      succeeded({ result: { outfit: "not a look" } }),
    ]) {
      expect(ask(row, { own: true, watched: true })).toBeNull();
    }
  });
});

describe("the recovery window: same local day, or finished within 12 hours (server times)", () => {
  // Local wall-clock times, so the day boundary is hers whatever zone the test runs in.
  const at = (month: number, day: number, hour: number, minute: number) =>
    new Date(2026, month - 1, day, hour, minute).getTime();
  const finished = (completedAt: number | null, createdAt = (completedAt ?? NOW) - 120_000) =>
    job({
      status: "succeeded",
      result: LOOK,
      created_at: new Date(createdAt).toISOString(),
      completed_at: completedAt === null ? null : new Date(completedAt).toISOString(),
    });

  test("23:58, then 00:02: the look from last night comes back, labelled", () => {
    const row = finished(at(10, 7, 23, 58));
    const now = at(10, 8, 0, 2);
    expect(isRecentLook(row, now)).toBe(true);
    expect(recoveredLookLabel(row, now)).toBe("From last night, 11:58 PM");
    expect(
      lookToRecover({ job: row, shown: null, own: false, watched: false, clearedAt: 0, now }),
    ).toMatchObject({ fromLabel: "From last night, 11:58 PM" });
  });

  test("12 hours is the edge for a look from before today", () => {
    const completed = at(10, 7, 23, 30);
    expect(isRecentLook(finished(completed), completed + 12 * 3_600_000)).toBe(true);
    expect(isRecentLook(finished(completed), completed + 12 * 3_600_000 + 1)).toBe(false);
  });

  test("earlier today always counts, however long ago, and needs no label", () => {
    const row = finished(at(10, 8, 0, 30));
    const now = at(10, 8, 23, 0);
    expect(isRecentLook(row, now)).toBe(true);
    expect(recoveredLookLabel(row, now)).toBeNull();
  });

  test("yesterday afternoon, inside 12 hours, says yesterday", () => {
    const row = finished(at(10, 7, 17, 5));
    expect(recoveredLookLabel(row, at(10, 8, 4, 0))).toBe("From yesterday, 5:05 PM");
  });

  test("an unfinished time falls back to when it was asked for", () => {
    const row = finished(null, at(10, 7, 23, 50));
    expect(isRecentLook(row, at(10, 8, 11, 0))).toBe(true);
    expect(isRecentLook(row, at(10, 8, 12, 0))).toBe(false);
  });

  test("labels carry no em or en dashes", () => {
    for (const hour of [0, 9, 13, 18, 23]) {
      const label = recoveredLookLabel(finished(at(10, 7, hour, 15)), at(10, 8, 1, 0));
      expect(label ?? "").not.toMatch(/[–—]/);
    }
  });
});

describe("a look she already saved never comes back (M2)", () => {
  test("asks her own outfits for this headline since the job started, sent as her", async () => {
    const fake = signedIn();
    fake.setTable("outfits", [
      {
        id: "o-1",
        user_id: USER,
        created_at: new Date(NOW).toISOString(),
        "analysis_result->outfit->>headline": LOOK.outfit.headline,
      },
    ]);
    const since = new Date(NOW - 60_000).toISOString();
    await expect(
      fetchLookSaved(fake.client as never, USER, LOOK, since, `Bearer ${TOKEN}`),
    ).resolves.toBe(true);
    const request = fake.requests.at(-1);
    expect(request?.table).toBe("outfits");
    expect(request?.filters).toMatchObject({
      user_id: USER,
      "analysis_result->outfit->>headline": LOOK.outfit.headline,
      "created_at>=": since,
    });
    expect(request?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("not saved, or saved before this job, is not saved", async () => {
    const fake = signedIn();
    fake.setTable("outfits", [
      {
        id: "o-1",
        user_id: USER,
        created_at: new Date(NOW - 3_600_000).toISOString(),
        "analysis_result->outfit->>headline": LOOK.outfit.headline,
      },
    ]);
    await expect(
      fetchLookSaved(fake.client as never, USER, LOOK, new Date(NOW).toISOString(), "Bearer x"),
    ).resolves.toBe(false);
  });

  test("the check only runs for a look about to come back", () => {
    expect(lookSavedQueryOptions(USER, null).enabled).toBe(false);
    expect(
      lookSavedQueryOptions(USER, { jobId: "job-1", look: LOOK, since: "2026-10-07T00:00:00Z" })
        .enabled,
    ).toBe(true);
  });
});

describe("a press whose request changed while an earlier one of hers is unanswered (I1)", () => {
  const pending = ["22222222-2222-4222-8222-222222222222"];

  test("her earlier job still running: attach to it, send nothing", () => {
    expect(pressDecision(job(), pending, NOW)).toBe("attach");
  });

  test("her earlier job finished: show it, send nothing", () => {
    expect(pressDecision(job({ status: "succeeded", result: LOOK }), pending, NOW)).toBe("recover");
  });

  test("failed, dead, someone else's or no job: send", () => {
    expect(pressDecision(job({ status: "failed", error_code: "x" }), pending, NOW)).toBe("send");
    const dead = job({ deadline_at: new Date(NOW - 60_000).toISOString() });
    expect(pressDecision(dead, pending, NOW)).toBe("send");
    expect(pressDecision(dead, pending, NOW, () => true)).toBe("attach");
    expect(pressDecision(job({ client_request_id: "someone-else" }), pending, NOW)).toBe("send");
    expect(pressDecision(null, pending, NOW)).toBe("send");
  });

  test("her earlier job finished with a result that cannot be shown: send, never swallow the press", () => {
    const unreadable = job({ status: "succeeded", result: { outfit: "not a look" } });
    expect(pressDecision(unreadable, pending, NOW)).toBe("send");
  });
});

describe("the check before a changed press is bounded (NEW-M1)", () => {
  const earlier = [
    { id: "11111111-aaaa-4aaa-8aaa-111111111111", key: "a", at: NOW - 60_000, sends: 1 },
    { id: "22222222-2222-4222-8222-222222222222", key: "b", at: NOW - 30_000, sends: 1 },
  ];
  const read = (state: Parameters<typeof changedPressPlan>[0]) =>
    changedPressPlan(state, earlier, NOW);

  test("no answer in time: the press goes ahead with her unanswered id, so the server attaches or replays", () => {
    expect(read({ status: "timed_out" })).toEqual({
      action: "send_as",
      id: "22222222-2222-4222-8222-222222222222",
    });
  });

  test("no answer in time and nothing unanswered: the new press proceeds", () => {
    expect(changedPressPlan({ status: "timed_out" }, [], NOW)).toEqual({ action: "send" });
  });

  test("a read that failed goes ahead under her unanswered id, like a timeout (round 3 ruling)", () => {
    // Charge-safe: the server answers a known id with its own job, never a second charge.
    expect(read({ status: "failed" })).toEqual({
      action: "send_as",
      id: "22222222-2222-4222-8222-222222222222",
    });
  });

  test("a read that failed with nothing unanswered: the press proceeds normally (round 3 ruling)", () => {
    expect(changedPressPlan({ status: "failed" }, [], NOW)).toEqual({ action: "send" });
  });

  test("her own rows read by id decide the same way, whichever is newest overall (round 3)", () => {
    const mine = (overrides: Record<string, unknown>) =>
      job({ client_request_id: "22222222-2222-4222-8222-222222222222", ...overrides });
    const ready = (jobs: MemberGenerationJob[]) => ({
      status: "read" as const,
      state: { status: "ready" as const, jobs },
    });
    expect(read(ready([mine({})]))).toEqual({ action: "attach" });
    expect(read(ready([mine({ status: "succeeded", result: LOOK })]))).toEqual({
      action: "recover",
    });
    // Still running beats finished: she is shown the one being made.
    expect(
      read(
        ready([
          mine({ id: "done", status: "succeeded", result: LOOK }),
          job({ id: "run", client_request_id: "11111111-aaaa-4aaa-8aaa-111111111111" }),
        ]),
      ),
    ).toEqual({ action: "attach" });
    expect(read(ready([mine({ status: "failed", error_code: "x" })]))).toEqual({ action: "send" });
    expect(read(ready([job({ client_request_id: "someone-else" })]))).toEqual({ action: "send" });
    expect(read(ready([]))).toEqual({ action: "send" });
  });

  test("a read that answered decides as before", () => {
    const running = { status: "ready" as const, job: job() };
    expect(read({ status: "read", state: running })).toEqual({ action: "attach" });
    const done = { status: "ready" as const, job: job({ status: "succeeded", result: LOOK }) };
    expect(read({ status: "read", state: done })).toEqual({ action: "recover" });
    expect(read({ status: "read", state: { status: "ready", job: null } })).toEqual({
      action: "send",
    });
    expect(read({ status: "read", state: { status: "unavailable" } })).toEqual({ action: "send" });
  });

  test("the read gives up after about 8 seconds", () => {
    expect(JOB_CHECK_TIMEOUT_MS).toBe(8_000);
  });
});

describe("reading her latest row within a time limit (NEW-M1)", () => {
  test("answers the row, sent as her", async () => {
    const fake = signedIn([rawRow()]);
    const result = await readLatestJobWithin(USER, "look", {
      client: fake.client as never,
      availability: createJobsAvailability(),
    });
    expect(result).toMatchObject({
      status: "read",
      state: { status: "ready", job: { id: "job-1" } },
    });
    expect(fake.requests[0]?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("a read that hangs is timed out and its request aborted", async () => {
    const fake = signedIn([rawRow()]);
    fake.setHang(true);
    const started = Date.now();
    const result = await readLatestJobWithin(USER, "look", {
      client: fake.client as never,
      availability: createJobsAvailability(),
      timeoutMs: 30,
    });
    expect(result).toEqual({ status: "timed_out" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(fake.requests[0]?.signal?.aborted).toBe(true);
  });

  test("a session read that hangs is timed out too", async () => {
    const fake = signedIn([rawRow()]);
    fake.setSessionHang(true);
    const result = await readLatestJobWithin(USER, "look", {
      client: fake.client as never,
      availability: createJobsAvailability(),
      timeoutMs: 30,
    });
    expect(result).toEqual({ status: "timed_out" });
  });

  test("an error answer is a failed read", async () => {
    const fake = fakeGenerationJobsClient({
      session: fakeMemberSession(USER, TOKEN),
      error: { code: "PGRST301", message: "JWT expired" },
    });
    const result = await readLatestJobWithin(USER, "look", {
      client: fake.client as never,
      availability: createJobsAvailability(),
    });
    expect(result).toEqual({ status: "failed" });
  });

  test("a missing table answers unavailable and is remembered", async () => {
    const availability = createJobsAvailability();
    const fake = fakeGenerationJobsClient({
      session: fakeMemberSession(USER, TOKEN),
      error: { code: "PGRST205", message: "missing" },
    });
    const first = await readLatestJobWithin(USER, "look", {
      client: fake.client as never,
      availability,
    });
    expect(first).toEqual({ status: "read", state: { status: "unavailable" } });
    expect(availability.isMissing()).toBe(true);
    await readLatestJobWithin(USER, "look", { client: fake.client as never, availability });
    expect(fake.requests).toHaveLength(1);
  });
});

describe("her unanswered presses are read by id, whatever is newest (round 3)", () => {
  const MINE = "22222222-2222-4222-8222-222222222222";
  const OTHER_DEVICE = "33333333-3333-4333-8333-333333333333";

  test("asks for her own rows of this kind with these request ids, sent as her", async () => {
    const fake = signedIn([
      rawRow({ id: "mine", client_request_id: MINE, status: "succeeded", result: LOOK }),
      rawRow({ id: "phone", client_request_id: OTHER_DEVICE, created_at: "2026-10-07T09:59:59Z" }),
      rawRow({ id: "sheet", kind: "style_sheet", client_request_id: MINE }),
    ]);
    const state = await fetchGenerationJobsByRequestIds(
      fake.client as never,
      USER,
      "look",
      [MINE],
      `Bearer ${TOKEN}`,
    );
    expect(state).toMatchObject({ status: "ready", jobs: [{ id: "mine" }] });
    if (state.status === "ready") expect(state.jobs).toHaveLength(1);
    const [request] = fake.requests;
    expect(request.filters).toEqual({
      user_id: USER,
      kind: "look",
      "client_request_id:in": [MINE],
    });
    expect(request.order).toEqual({ column: "created_at", ascending: false });
    expect(request.authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("a missing table is unavailable; any other error throws", async () => {
    const missing = fakeGenerationJobsClient({
      session: fakeMemberSession(USER, TOKEN),
      error: { code: "42P01", message: "missing" },
    });
    await expect(
      fetchGenerationJobsByRequestIds(missing.client as never, USER, "look", [MINE], "Bearer x"),
    ).resolves.toEqual({ status: "unavailable" });
    const broken = fakeGenerationJobsClient({
      session: fakeMemberSession(USER, TOKEN),
      error: { code: "PGRST301", message: "JWT expired" },
    });
    await expect(
      fetchGenerationJobsByRequestIds(broken.client as never, USER, "look", [MINE], "Bearer x"),
    ).rejects.toMatchObject({ code: "PGRST301" });
  });

  test("is read within the same time limit, and a hung read is aborted", async () => {
    const fake = signedIn([rawRow({ client_request_id: MINE })]);
    fake.setHang(true);
    const result = await readOwnJobsWithin(USER, "look", [MINE], {
      client: fake.client as never,
      availability: createJobsAvailability(),
      timeoutMs: 30,
    });
    expect(result).toEqual({ status: "timed_out" });
    expect(fake.requests[0]?.signal?.aborted).toBe(true);
  });

  test("answers her rows when it can", async () => {
    const fake = signedIn([rawRow({ client_request_id: MINE })]);
    const result = await readOwnJobsWithin(USER, "look", [MINE], {
      client: fake.client as never,
      availability: createJobsAvailability(),
    });
    expect(result).toMatchObject({
      status: "read",
      state: { status: "ready", jobs: [{ id: "job-1" }] },
    });
  });

  test("the page's query is its own, keyed by her ids, and only runs when she has some", () => {
    const options = ownGenerationJobsQueryOptions(USER, "look", [MINE, "a-second-id"]);
    expect(options.queryKey).not.toEqual(generationJobKeys.latest(USER, "look"));
    // Under her job rows, so every refresh of them refreshes it too.
    expect(options.queryKey.slice(0, 2)).toEqual([...generationJobKeys.all(USER)]);
    // The same ids in any order are the same query.
    expect(ownGenerationJobsQueryOptions(USER, "look", ["a-second-id", MINE]).queryKey).toEqual(
      options.queryKey,
    );
    expect(options.enabled).toBe(true);
    expect(ownGenerationJobsQueryOptions(USER, "look", []).enabled).toBe(false);
    expect(ownGenerationJobsQueryOptions(USER, "look", [MINE], { enabled: false }).enabled).toBe(
      false,
    );
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  test("the query polls only while one of her own jobs is still being made", async () => {
    const fake = signedIn([rawRow({ client_request_id: MINE })]);
    const client = new QueryClient();
    const options = ownGenerationJobsQueryOptions(USER, "look", [MINE], {
      client: fake.client as never,
      availability: createJobsAvailability(),
      serverNow: () => NOW,
    });
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => {});
    await until(() => observer.getCurrentResult().status === "success");
    const query = client.getQueryCache().find({ queryKey: options.queryKey });
    const interval = options.refetchInterval as (q: unknown) => number | false;
    expect(interval(query)).toBe(GENERATION_POLL_MS);
    fake.setRows([rawRow({ client_request_id: MINE, status: "succeeded", result: LOOK })]);
    await observer.refetch();
    expect(interval(query)).toBe(false);
    unsubscribe();
    client.clear();
  });

  test("the query fails (and keeps her last rows) when the read gets no answer in time", async () => {
    const fake = signedIn([rawRow({ client_request_id: MINE })]);
    fake.setHang(true);
    const options = ownGenerationJobsQueryOptions(USER, "look", [MINE], {
      client: fake.client as never,
      availability: createJobsAvailability(),
      timeoutMs: 30,
    });
    await expect(
      (options.queryFn as (context: unknown) => Promise<unknown>)({ queryKey: options.queryKey }),
    ).rejects.toThrow();
  });

  test("her own job behind another device's newer one is the one followed", () => {
    const latest = job({ id: "phone", client_request_id: OTHER_DEVICE });
    const mine = job({
      id: "mine",
      client_request_id: MINE,
      status: "succeeded",
      result: LOOK,
      created_at: new Date(NOW - 90_000).toISOString(),
    });
    expect(ownJobBehindLatest([mine], latest)?.id).toBe("mine");
    expect(ownJobBehindLatest([mine], null)?.id).toBe("mine");
    // Her job IS the latest row: nothing is hidden behind it.
    expect(ownJobBehindLatest([mine], mine)).toBeNull();
    expect(ownJobBehindLatest([], latest)).toBeNull();
    // Two of hers behind it: the newest.
    const older = job({
      id: "older",
      client_request_id: "x",
      created_at: new Date(NOW - 500_000).toISOString(),
    });
    expect(ownJobBehindLatest([older, mine], latest)?.id).toBe("mine");
  });

  test("why the page must look again on its own: a return to the tab while a read is in flight is merged into that read, so a row that appeared meanwhile is missed (round 4)", async () => {
    const fake = signedIn([]);
    const client = new QueryClient();
    client.mount();
    const observer = new QueryObserver(
      client,
      ownGenerationJobsQueryOptions(USER, "look", [MINE], {
        client: fake.client as never,
        availability: createJobsAvailability(),
      }),
    );
    // A read is on its way back, answered before her row existed.
    const release = fake.holdReads();
    const stop = observer.subscribe(() => {});
    await until(() => fake.requests.length === 1);
    fake.setRows([rawRow({ client_request_id: MINE })]);
    // She comes back to the tab: TanStack merges this into the read in flight.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await flush();
    expect(fake.requests).toHaveLength(1);
    release();
    await until(() => observer.getCurrentResult().status === "success");
    expect(observer.getCurrentResult().data).toEqual({ status: "ready", jobs: [] });
    stop();
    client.unmount();
    client.clear();
  });

  test("her unanswered press with no row yet is looked for again on its own, so a row that appears later is found without a return to the tab (round 4)", async () => {
    const fake = signedIn([]);
    const client = new QueryClient();
    const options = ownGenerationJobsQueryOptions(USER, "look", [MINE], {
      client: fake.client as never,
      availability: createJobsAvailability(),
      rowExpectedUntil: Date.now() + 60_000,
      awaitRowPollMs: 20,
    });
    const observer = new QueryObserver(client, options);
    const release = fake.holdReads();
    const stop = observer.subscribe(() => {});
    await until(() => fake.requests.length === 1);
    // Her row appears after the server answered the read in flight.
    fake.setRows([rawRow({ client_request_id: MINE })]);
    release();
    await until(() => observer.getCurrentResult().status === "success");
    expect(observer.getCurrentResult().data).toEqual({ status: "ready", jobs: [] });
    // The query asks to be read again on its own. (TanStack schedules intervals
    // only in a browser, so the tick is run here by hand, as it would fire.)
    const query = client.getQueryCache().find({ queryKey: options.queryKey });
    expect((options.refetchInterval as (q: unknown) => number | false)(query)).toBe(20);
    await observer.refetch();
    expect(observer.getCurrentResult().data).toMatchObject({
      status: "ready",
      jobs: [{ clientRequestId: MINE }],
    });
    stop();
    client.clear();
  });

  test("it looks again only while a missing row could still appear (round 4)", () => {
    const interval = (rowExpectedUntil: number, data: unknown) =>
      (
        ownGenerationJobsQueryOptions(USER, "look", [MINE], {
          rowExpectedUntil,
          deviceNow: () => NOW,
          serverNow: () => NOW,
        }).refetchInterval as (q: unknown) => number | false
      )({ state: { data } });
    const none = { status: "ready", jobs: [] };
    expect(interval(NOW + 1, none)).toBe(IN_FLIGHT_POLL_MS);
    // Not read yet (or the read failed): keep looking.
    expect(interval(NOW + 1, undefined)).toBe(IN_FLIGHT_POLL_MS);
    // Past the time its row could appear: the press never reached the server.
    expect(interval(NOW, none)).toBe(false);
    // Every id has its row, and none is running.
    const settled = job({ client_request_id: MINE, status: "failed", error_code: "x" });
    expect(interval(NOW + 1, { status: "ready", jobs: [settled] })).toBe(false);
    expect(interval(NOW + 1, { status: "unavailable" })).toBe(false);
  });

  test("a row can appear until a few minutes after her newest unanswered press", () => {
    expect(OWN_ROW_WAIT_MS).toBe(5 * 60_000);
    expect(
      ownRowsExpectedUntil([
        { id: "a", key: "a", at: NOW - 60_000 },
        { id: "b", key: "b", at: NOW },
      ]),
    ).toBe(NOW + OWN_ROW_WAIT_MS);
    expect(ownRowsExpectedUntil([])).toBe(0);
  });
});

describe("round 4: a press after a check with no answer goes under its own id (I-A)", () => {
  const A = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    key: "brunch",
    at: NOW - 120_000,
    sends: 1,
  };

  test("A never arrived, B ran but its answer was lost, she repeats B: it goes out as B, never as A", () => {
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    for (const read of [{ status: "failed" as const }, { status: "timed_out" as const }]) {
      expect(changedPressPlan(read, [A], NOW, undefined, B)).toEqual({ action: "send_as", id: B });
    }
  });

  test("with no unanswered id of its own, the latest unanswered one is used, as ruled", () => {
    expect(changedPressPlan({ status: "failed" }, [A], NOW, undefined, null)).toEqual({
      action: "send_as",
      id: A.id,
    });
  });
});

describe("round 4: a look that landed during the check answers the press (I-B)", () => {
  test("a look that came onto the screen while the check ran: shown, not wiped", () => {
    expect(lookAnswersPress({ shownBefore: null, shownNow: "job-a", herJobIds: [] })).toBe(true);
    expect(lookAnswersPress({ shownBefore: "old", shownNow: "job-a", herJobIds: [] })).toBe(true);
  });

  test("a look on screen from one of her unanswered jobs answers it too", () => {
    expect(
      lookAnswersPress({ shownBefore: "job-a", shownNow: "job-a", herJobIds: ["job-a"] }),
    ).toBe(true);
  });

  test("an older look she chose to replace does not, and neither does an empty screen", () => {
    expect(lookAnswersPress({ shownBefore: "old", shownNow: "old", herJobIds: ["job-a"] })).toBe(
      false,
    );
    expect(lookAnswersPress({ shownBefore: null, shownNow: null, herJobIds: ["job-a"] })).toBe(
      false,
    );
    expect(lookAnswersPress({ shownBefore: "old", shownNow: null, herJobIds: [] })).toBe(false);
  });
});

describe("round 4: a look's vibe and weather are settled from the answer itself (R3-1)", () => {
  const FIRST = { vibe: "Brunch", weather: "24°C Sunny (in Manila)" };
  const pressAsked = { vibe: "Date Night", weatherLabel: "19°C Rain (Lisbon)" };
  const entry = {
    id: "22222222-2222-4222-8222-222222222222",
    key: "a",
    at: NOW,
    sends: 2,
    asked: FIRST,
  };

  test("the answer's job is one the page already holds: its own input, at once", () => {
    const cached = job({ id: "the-job", status: "succeeded", result: LOOK, input: FIRST });
    expect(answerAsked({ cachedJob: cached, sentAs: entry.id, entry, pressAsked })).toEqual({
      asked: { vibe: "Brunch", weatherLabel: "24°C Sunny (Manila)" },
      confirmed: true,
    });
    // Another running job's look returned to this press: corrected the same way.
    expect(answerAsked({ cachedJob: cached, sentAs: null, entry: null, pressAsked })).toMatchObject(
      {
        asked: { vibe: "Brunch" },
        confirmed: true,
      },
    );
  });

  test("sent under its own request's id: this press's own, settled", () => {
    expect(answerAsked({ cachedJob: null, sentAs: null, entry: null, pressAsked })).toEqual({
      asked: pressAsked,
      confirmed: true,
    });
  });

  test("sent under a borrowed id and not held: the first press's guess, still to be confirmed", () => {
    expect(answerAsked({ cachedJob: null, sentAs: entry.id, entry, pressAsked })).toEqual({
      asked: { vibe: "Brunch", weatherLabel: "24°C Sunny (Manila)" },
      confirmed: false,
    });
  });

  test("the confirmation reads that job's row: a job the changed press made keeps the changed vibe", async () => {
    const fake = signedIn([
      rawRow({
        id: "fresh-job",
        client_request_id: entry.id,
        status: "succeeded",
        result: LOOK,
        input: { vibe: "Date Night", weather: "19°C Rain (in Lisbon)" },
      }),
    ]);
    await expect(
      confirmLookAsked(USER, {
        requestId: entry.id,
        jobId: "fresh-job",
        entry,
        fallback: { vibe: "Brunch", weatherLabel: "24°C Sunny (Manila)" },
        client: fake.client as never,
        availability: createJobsAvailability(),
      }),
    ).resolves.toEqual({ asked: pressAsked, confirmed: true });
  });

  // Round 5 (N-3): a confirmation that cannot read never turns the guess into
  // a confirmed vibe; the guess stays for display only, marked unconfirmed.
  test("a confirmation that cannot read stays unconfirmed (round 5)", async () => {
    const fake = signedIn([]);
    fake.setHang(true);
    const guess = { vibe: "Brunch", weatherLabel: "24°C Sunny (Manila)" };
    await expect(
      confirmLookAsked(USER, {
        requestId: entry.id,
        jobId: "fresh-job",
        entry,
        fallback: guess,
        client: fake.client as never,
        availability: createJobsAvailability(),
        timeoutMs: 20,
      }),
    ).resolves.toEqual({ asked: guess, confirmed: false });
  });

  test("a confirmation that reads no row for the job stays unconfirmed (round 5)", async () => {
    const fake = signedIn([]);
    const guess = { vibe: "Brunch", weatherLabel: "24°C Sunny (Manila)" };
    await expect(
      confirmLookAsked(USER, {
        requestId: entry.id,
        jobId: "fresh-job",
        entry,
        fallback: guess,
        client: fake.client as never,
        availability: createJobsAvailability(),
      }),
    ).resolves.toEqual({ asked: guess, confirmed: false });
  });

  test("with the server's replay flag, a borrowed-id answer is settled at arrival (round 5)", () => {
    // Not a replay: this press started the job, so its own vibe is the job's.
    expect(
      answerAsked({ cachedJob: null, sentAs: entry.id, entry, pressAsked, replayed: false }),
    ).toEqual({ asked: pressAsked, confirmed: true });
    // A replay of a job the page does not hold: still confirmed from its row.
    expect(
      answerAsked({ cachedJob: null, sentAs: entry.id, entry, pressAsked, replayed: true }),
    ).toMatchObject({ confirmed: false });
  });

  test("the page's cached rows are searched for the answer's job", () => {
    const mine = job({ id: "the-job", status: "succeeded", result: LOOK });
    expect(
      findCachedJob(
        [
          undefined,
          { status: "unavailable" },
          { status: "ready", job: null },
          { status: "ready", jobs: [job({ id: "other" }), mine] },
        ],
        "the-job",
      )?.id,
    ).toBe("the-job");
    expect(findCachedJob([{ status: "ready", job: mine }], "the-job")?.id).toBe("the-job");
    expect(findCachedJob([{ status: "ready", job: mine }], "missing")).toBeNull();
  });
});

describe("round 4, then round 5 (N-1): the hold on other looks", () => {
  const MINE = "22222222-2222-4222-8222-222222222222";
  const live = (state: unknown, deviceNow = NOW, requestIds: string[] = [MINE]) =>
    ownPressesHold({
      state: state as never,
      requestIds,
      // Her newest press was a minute ago: a row may appear until 4 minutes from now.
      rowExpectedUntil: NOW - 60_000 + OWN_ROW_WAIT_MS,
      deviceNow,
      now: NOW,
    });
  const mine = (overrides: Record<string, unknown> = {}) =>
    job({ client_request_id: MINE, ...overrides });

  test("held while one of her jobs is still being made, or finished and waiting to land", () => {
    expect(live({ status: "ready", jobs: [mine()] })).toBe(true);
    expect(live({ status: "ready", jobs: [mine({ status: "succeeded", result: LOOK })] })).toBe(
      true,
    );
  });

  test("lifted at once when every id is read and none is live: failed, or cannot be shown", () => {
    expect(live({ status: "ready", jobs: [mine({ status: "failed", error_code: "x" })] })).toBe(
      false,
    );
    expect(
      live({ status: "ready", jobs: [mine({ status: "succeeded", result: { outfit: "x" } })] }),
    ).toBe(false);
    expect(live({ status: "unavailable" })).toBe(false);
  });

  test("her ids could not be read: held until 5 minutes after her newest press (round 5)", () => {
    expect(live(undefined)).toBe(true);
    expect(live(undefined, NOW - 60_000 + OWN_ROW_WAIT_MS - 1)).toBe(true);
    expect(live(undefined, NOW - 60_000 + OWN_ROW_WAIT_MS)).toBe(false);
  });

  test("one of her rows has not appeared yet: held while it can still appear (round 5)", () => {
    expect(live({ status: "ready", jobs: [] })).toBe(true);
    expect(live({ status: "ready", jobs: [] }, NOW - 60_000 + OWN_ROW_WAIT_MS)).toBe(false);
    // One read and settled, the other not seen yet: still held.
    const other = "33333333-3333-4333-8333-333333333333";
    expect(
      live({ status: "ready", jobs: [mine({ status: "failed", error_code: "x" })] }, NOW, [
        MINE,
        other,
      ]),
    ).toBe(true);
  });

  test("the exact trigger: her ids cannot be read, a newer look from her phone exists, then her own job succeeds and lands (round 5)", () => {
    const phone = job({
      id: "phone-job",
      client_request_id: "88888888-8888-4888-8888-888888888888",
      status: "succeeded",
      result: LOOK,
      created_at: new Date(NOW - 20_000).toISOString(),
      completed_at: new Date(NOW - 10_000).toISOString(),
    });
    // The read of her ids failed: her press may still be running.
    const held = live(undefined);
    expect(held).toBe(true);
    expect(
      lookToRecover({
        job: phone,
        shown: null,
        own: false,
        watched: false,
        ownPending: held,
        clearedAt: NOW - 120_000,
        now: NOW,
      }),
    ).toBeNull();
    // Her ids are read again: her own job has succeeded. It lands on the clear screen.
    const hers = mine({
      id: "her-job",
      status: "succeeded",
      result: LOOK,
      created_at: new Date(NOW - 100_000).toISOString(),
    });
    expect(live({ status: "ready", jobs: [hers] })).toBe(true);
    expect(
      lookToRecover({
        job: hers,
        shown: null,
        own: true,
        watched: false,
        ownPending: true,
        clearedAt: NOW - 120_000,
        now: NOW,
      }),
    ).toMatchObject({ jobId: "her-job", own: true });
  });
});

describe("round 5 (N-1 nit): the row window and the ledger run from her newest send", () => {
  test("a resend refreshes when its row can appear, and how long the id is kept", () => {
    let now = NOW;
    const ledger = createGenerationRequestLedger({ storage: () => null, now: () => now });
    const id = ledger.begin(USER, "look", "a");
    now += 4 * 60_000;
    ledger.begin(USER, "look", "a");
    const entry = ledger.owns(USER, "look", id);
    expect(entry).toMatchObject({ at: NOW, lastAt: NOW + 4 * 60_000, sends: 2 });
    expect(ownRowsExpectedUntil(entry ? [entry] : [])).toBe(NOW + 4 * 60_000 + OWN_ROW_WAIT_MS);
    // Ten minutes after the first press but six after the resend: still hers.
    now = NOW + 10 * 60_000 + 1;
    expect(ledger.owns(USER, "look", id)?.id).toBe(id);
    now = NOW + 4 * 60_000 + 10 * 60_000 + 1;
    expect(ledger.owns(USER, "look", id)).toBeNull();
  });

  test("a borrowed resend refreshes it too", () => {
    let now = NOW;
    const ledger = createGenerationRequestLedger({ storage: () => null, now: () => now });
    const id = ledger.begin(USER, "look", "a");
    now += 2 * 60_000;
    ledger.reuse(USER, "look", id);
    expect(ledger.owns(USER, "look", id)?.lastAt).toBe(NOW + 2 * 60_000);
  });
});

describe("round 4: a real refusal retires only this request's own id (M-1)", () => {
  test("a borrowed id survives a refusal of the press sent under it", () => {
    const borrowed = { id: "a", key: "brunch", at: NOW };
    expect(refusalRetires(borrowed, "date-night")).toBe(false);
  });

  test("a resend of this request's own id refused before running keeps it: its earlier send may have run (round 5, m-3)", () => {
    expect(refusalRetires({ id: "b", key: "date-night", at: NOW, sends: 2 }, "date-night")).toBe(
      false,
    );
  });

  test("this request's own id is retired, as before", () => {
    expect(refusalRetires({ id: "b", key: "date-night", at: NOW, sends: 1 }, "date-night")).toBe(
      true,
    );
    // Unknown (expired or never kept): nothing to keep.
    expect(refusalRetires(null, "date-night")).toBe(true);
  });
});

describe("a look answered under a reused id keeps its own vibe and weather (round 3)", () => {
  const FIRST = { vibe: "Brunch", weather: "24°C Sunny (in Manila)" };
  const pressNow = { vibe: "Date Night", weatherLabel: "19°C Rain (Lisbon)" };
  const entry = {
    id: "22222222-2222-4222-8222-222222222222",
    key: "a",
    at: NOW,
    sends: 2,
    asked: FIRST,
  };

  test("a replay after a changed press is saved with the first press's vibe, from its job row", () => {
    const row = job({ status: "succeeded", result: LOOK, input: FIRST });
    expect(askedForLook(row, entry, pressNow)).toEqual({
      vibe: "Brunch",
      weatherLabel: "24°C Sunny (Manila)",
    });
  });

  test("when the job was made by the changed press (the first never arrived), its row says so", () => {
    const row = job({
      status: "succeeded",
      result: LOOK,
      input: { vibe: "Date Night", weather: "19°C Rain (in Lisbon)" },
    });
    expect(askedForLook(row, entry, pressNow)).toEqual(pressNow);
  });

  test("no row to read: the first press's vibe and weather, kept with its id", () => {
    expect(askedForLook(null, entry, pressNow)).toEqual({
      vibe: "Brunch",
      weatherLabel: "24°C Sunny (Manila)",
    });
  });

  test("a row for another request is never used", () => {
    const other = job({ client_request_id: "someone-else", input: { vibe: "Party" } });
    expect(askedForLook(other, entry, pressNow).vibe).toBe("Brunch");
  });

  test("nothing kept anywhere: this press's own", () => {
    expect(askedForLook(null, { ...entry, asked: undefined }, pressNow)).toEqual(pressNow);
    expect(askedForLook(null, null, pressNow)).toEqual(pressNow);
  });

  test("the ledger keeps the first press's vibe and weather with its id, through a reload", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    const ledger = createGenerationRequestLedger({ storage: () => storage });
    const id = ledger.begin(USER, "look", "a", FIRST);
    // A changed press sent under it never overwrites what it was first asked for.
    ledger.reuse(USER, "look", id);
    ledger.begin(USER, "look", "a", { vibe: "Party", weather: "x" });
    const afterReload = createGenerationRequestLedger({ storage: () => storage });
    expect(afterReload.owns(USER, "look", id)?.asked).toEqual(FIRST);
  });
});

describe("the check before a press is visible and one at a time (NEW-M1)", () => {
  test("starts once, tells every listener, and ends", () => {
    const check = createPressCheck();
    let heard = 0;
    const stop = check.subscribe(() => {
      heard += 1;
    });
    expect(check.isChecking()).toBe(false);
    expect(check.start()).toBe(true);
    expect(check.isChecking()).toBe(true);
    // A second press while it runs is not a second check.
    expect(check.start()).toBe(false);
    check.finish();
    expect(check.isChecking()).toBe(false);
    expect(heard).toBe(2);
    stop();
    check.start();
    expect(heard).toBe(2);
    check.finish();
  });
});

describe("an offline press is refused, never sent later on its own (NEW-M1)", () => {
  test("offline when the query client or the browser says so", () => {
    const online = { isOnline: () => true };
    const offline = { isOnline: () => false };
    expect(deviceIsOffline(online, { onLine: true })).toBe(false);
    expect(deviceIsOffline(offline, { onLine: true })).toBe(true);
    // The query client assumes online until an "offline" event; a page
    // opened offline is caught by the browser's own flag.
    expect(deviceIsOffline(online, { onLine: false })).toBe(true);
    expect(deviceIsOffline(online, null)).toBe(false);
  });

  test("a generation call is never paused offline and fired later: it runs or fails now", () => {
    const options = generationMutationOptions("look", async () => "ok", new QueryClient());
    expect(options.networkMode).toBe("always");
  });
});

describe("which picture comes back", () => {
  const sheet = (overrides: Record<string, unknown> = {}) =>
    job({
      kind: "style_sheet",
      status: "succeeded",
      input: { outfit: LOOK },
      image_path: `${USER}/job-1.jpg`,
      result: { mode: "style_sheet", image_path: `${USER}/job-1.jpg` },
      completed_at: new Date(NOW).toISOString(),
      ...overrides,
    });

  test("a succeeded picture for the look on screen, when none is shown", () => {
    expect(visualToRecover(sheet(), LOOK, false)?.id).toBe("job-1");
    expect(visualToRecover(sheet(), LOOK, true)).toBeNull();
    expect(visualToRecover(sheet(), null, false)).toBeNull();
  });

  test("never a picture drawn for a different look", () => {
    const other = { ...LOOK, outfit: { ...LOOK.outfit, headline: "Something else" } };
    expect(visualToRecover(sheet(), other, false)).toBeNull();
  });

  test("never an image from a row that did not succeed (N2: refunded uploads stay hidden)", () => {
    expect(
      visualToRecover(
        sheet({ status: "failed", error_code: "deadline_exceeded", credit_state: "refunded" }),
        LOOK,
        false,
      ),
    ).toBeNull();
    expect(visualToRecover(sheet({ status: "running", completed_at: null }), LOOK, false)).toBe(
      null,
    );
  });

  test("a sheet that was never drawn for this look is told apart from one that failed", () => {
    expect(styleSheetNeverDrawn(null, LOOK)).toBe(true);
    const other = { ...LOOK, outfit: { ...LOOK.outfit, headline: "Something else" } };
    expect(styleSheetNeverDrawn(sheet(), other)).toBe(true);
    // Delivered to the request that asked, never kept: not a failure (N7).
    expect(
      styleSheetNeverDrawn(sheet({ status: "failed", error_code: PERSIST_FAILED_DELIVERED }), LOOK),
    ).toBe(true);
    expect(
      styleSheetNeverDrawn(sheet({ status: "failed", error_code: "render_failed" }), LOOK),
    ).toBe(false);
    expect(styleSheetNeverDrawn(sheet(), LOOK)).toBe(false);
    expect(styleSheetNeverDrawn(null, null)).toBe(false);
  });
});

describe("loading a picture from the private bucket", () => {
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  const fetchOk = (async () => new Response(png, { status: 200 })) as FetchLike;

  test("signs her succeeded row's own path and hands back a data URI the save path accepts", async () => {
    const fake = signedIn();
    const row = job({ status: "succeeded", image_path: `${USER}/job-1.png` });
    const uri = await loadGenerationImage(fake.client as never, USER, row, fetchOk);
    expect(uri).toBe("data:image/png;base64,iVBORw==");
    expect(fake.storageCalls).toEqual([
      { op: "createSignedUrl", bucket: "generations", path: `${USER}/job-1.png`, expiresIn: 600 },
    ]);
  });

  test("never signs a failed row's image, another member's path, and never lists", async () => {
    const fake = signedIn();
    const failed = job({
      status: "failed",
      error_code: "deadline_exceeded",
      image_path: `${USER}/job-1.jpg`,
    });
    await expect(
      loadGenerationImage(fake.client as never, USER, failed, fetchOk),
    ).rejects.toThrow();
    const foreign = job({ status: "succeeded", image_path: "someone-else/job-1.jpg" });
    await expect(
      loadGenerationImage(fake.client as never, USER, foreign, fetchOk),
    ).rejects.toThrow();
    const escape = job({ status: "succeeded", image_path: `${USER}/../other/job-1.jpg` });
    await expect(
      loadGenerationImage(fake.client as never, USER, escape, fetchOk),
    ).rejects.toThrow();
    expect(fake.storageCalls).toEqual([]);
  });

  test("the image query is only enabled for a succeeded row in her folder", () => {
    const ok = job({ status: "succeeded", image_path: `${USER}/job-1.jpg` });
    expect(generationImageQueryOptions(USER, ok).enabled).toBe(true);
    expect(generationImageQueryOptions(USER, ok).queryKey).toEqual(
      generationJobKeys.image(USER, "job-1"),
    );
    const delivered = job({
      status: "failed",
      error_code: PERSIST_FAILED_DELIVERED,
      image_path: `${USER}/job-1.jpg`,
    });
    expect(generationImageQueryOptions(USER, delivered).enabled).toBe(false);
    expect(generationImageQueryOptions(USER, null).enabled).toBe(false);
    expect(generationImageQueryOptions(undefined, ok).enabled).toBe(false);
  });

  test("a refused signing while she reconnects is retried, not shown as broken", async () => {
    const fake = fakeGenerationJobsClient({
      session: fakeMemberSession(USER, TOKEN),
      signError: { message: "reconnecting", statusCode: SESSION_UNAVAILABLE_CODE },
    });
    const row = job({ status: "succeeded", image_path: `${USER}/job-1.jpg` });
    const error = await loadGenerationImage(fake.client as never, USER, row, fetchOk).catch(
      (e: unknown) => e,
    );
    expect(memberQueryRetry(5, error)).toBe(true);
  });
});

describe("request ids", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  }
  const ids = (entries: Array<{ id: string }>) => entries.map((entry) => entry.id);

  test("every new action gets a fresh uuid", () => {
    const ledger = createGenerationRequestLedger({ storage: () => null });
    const first = ledger.begin(USER, "look", "a");
    ledger.settle(USER, "look", first);
    const second = ledger.begin(USER, "look", "a");
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  test("a second press of the same request before it is answered re-uses the id: one charge", () => {
    const ledger = createGenerationRequestLedger({ storage: () => null });
    const first = ledger.begin(USER, "look", generationRequestKey({ vibe: "Brunch", tempC: 24 }));
    const again = ledger.begin(USER, "look", generationRequestKey({ tempC: 24, vibe: "Brunch" }));
    expect(again).toBe(first);
  });

  test("a different request, or another kind, gets its own id", () => {
    const ledger = createGenerationRequestLedger({ storage: () => null });
    const look = ledger.begin(USER, "look", "a");
    expect(ledger.begin(USER, "look", "b")).not.toBe(look);
    expect(ledger.begin(USER, "style_sheet", "b")).not.toBe(look);
  });

  test("a changed press never evicts an earlier unanswered id (I1)", () => {
    const ledger = createGenerationRequestLedger({ storage: () => null });
    const first = ledger.begin(USER, "look", "a");
    const second = ledger.begin(USER, "look", "b");
    expect(ids(ledger.pending(USER, "look"))).toEqual([first, second]);
    expect(ledger.owns(USER, "look", first)?.key).toBe("a");
    // The server refuses the second press: only that id is retired.
    ledger.settle(USER, "look", second);
    expect(ids(ledger.pending(USER, "look"))).toEqual([first]);
    // Pressing the first request again still reuses its id.
    expect(ledger.begin(USER, "look", "a")).toBe(first);
  });

  test("survives a reload in the same tab, and expires after the job could have run", () => {
    const storage = memoryStorage();
    let now = NOW;
    const first = createGenerationRequestLedger({ storage: () => storage, now: () => now });
    const id = first.begin(USER, "look", "a");
    const afterReload = createGenerationRequestLedger({ storage: () => storage, now: () => now });
    expect(afterReload.owns(USER, "look", id)?.id).toBe(id);
    expect(afterReload.begin(USER, "look", "a")).toBe(id);
    now += 11 * 60_000;
    expect(afterReload.pending(USER, "look")).toEqual([]);
    expect(afterReload.begin(USER, "look", "a")).not.toBe(id);
  });

  test("is kept per member: another sign-in in this tab never inherits her ids (N2)", () => {
    const storage = memoryStorage();
    const ledger = createGenerationRequestLedger({ storage: () => storage });
    const hers = ledger.begin(USER, "look", "a");
    expect(ledger.pending("someone-else", "look")).toEqual([]);
    expect(ledger.owns("someone-else", "look", hers)).toBeNull();
    expect(ledger.begin("someone-else", "look", "a")).not.toBe(hers);
    expect(ids(ledger.pending(USER, "look"))).toEqual([hers]);
  });

  test("storage that throws (private mode) still works in memory", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const ledger = createGenerationRequestLedger({ storage: () => throwing });
    const id = ledger.begin(USER, "look", "a");
    expect(ledger.begin(USER, "look", "a")).toBe(id);
    ledger.settle(USER, "look", id);
    expect(ledger.pending(USER, "look")).toEqual([]);
  });

  test("counts how many times an id was sent, so a reused id's press time is known to be stale (NEW-M2)", () => {
    let now = NOW;
    const ledger = createGenerationRequestLedger({ storage: () => null, now: () => now });
    const id = ledger.begin(USER, "look", "a");
    expect(ledger.owns(USER, "look", id)).toMatchObject({ at: NOW, sends: 1 });
    now += 6 * 60_000;
    expect(ledger.begin(USER, "look", "a")).toBe(id);
    // The first press time is kept (it bounds the id's life); the count says it was sent again.
    expect(ledger.owns(USER, "look", id)).toMatchObject({ at: NOW, sends: 2 });
  });

  test("a changed press can be sent under her unanswered id (NEW-M1), counted as a resend", () => {
    const storage = memoryStorage();
    const ledger = createGenerationRequestLedger({ storage: () => storage });
    const first = ledger.begin(USER, "look", "a");
    expect(ledger.reuse(USER, "look", first)).toBe(first);
    expect(ledger.owns(USER, "look", first)).toMatchObject({ key: "a", sends: 2 });
    // After a reload too.
    const afterReload = createGenerationRequestLedger({ storage: () => storage });
    expect(afterReload.owns(USER, "look", first)?.sends).toBe(2);
    // An id that is no longer hers (answered, expired) is never reused.
    ledger.settle(USER, "look", first);
    expect(ledger.reuse(USER, "look", first)).toBeNull();
  });

  test("settling someone else's id leaves hers alone", () => {
    const ledger = createGenerationRequestLedger({ storage: () => null });
    const id = ledger.begin(USER, "look", "a");
    ledger.settle(USER, "look", "not-hers");
    expect(ids(ledger.pending(USER, "look"))).toEqual([id]);
  });

  test("request keys ignore key order and empty optional fields", () => {
    expect(generationRequestKey({ a: 1, b: null, c: undefined })).toBe(
      generationRequestKey({ a: 1 }),
    );
    expect(generationRequestKey({ a: 1 })).not.toBe(generationRequestKey({ a: 2 }));
  });

  test("only a lost answer keeps the id; a real answer from the server retires it", () => {
    expect(isUnknownGenerationOutcome(new TimeoutError())).toBe(true);
    expect(isUnknownGenerationOutcome(new TypeError("Failed to fetch"))).toBe(true);
    expect(isUnknownGenerationOutcome(new Error("Server function info not found"))).toBe(true);
    expect(isUnknownGenerationOutcome(new Error("Mila couldn't compose a look this time."))).toBe(
      false,
    );
    expect(isUnknownGenerationOutcome({ code: "INSUFFICIENT_CREDITS" })).toBe(false);
  });

  test("mutation keys are stable per kind", () => {
    expect(generationMutationKey("look")).toEqual(["generation", "look"]);
    expect(generationMutationKey("photo_preview")).toEqual(["generation", "photo_preview"]);
  });
});

describe("waiting copy", () => {
  test("names the stage, the time, and that she can leave", () => {
    const copy = generationWaitCopy("look", 40_000, { canLeave: true });
    expect(copy.line).toBe("Choosing pieces · about 2 minutes · you can leave this page");
    expect(copy.stage).toBe("Choosing pieces");
    expect(copy.detail).toBe("About 2 minutes · you can leave this page");
  });

  test("moves through stages as time passes", () => {
    const stages = [0, 40_000, 120_000, 200_000].map(
      (ms) => generationWaitCopy("look", ms, { canLeave: true }).stage,
    );
    expect(new Set(stages).size).toBe(4);
  });

  test("never promises she can leave while jobs are not live", () => {
    for (const kind of ["look", "style_sheet", "photo_preview"] as const) {
      expect(generationWaitCopy(kind, 40_000, { canLeave: false }).line).not.toContain("leave");
    }
  });

  test("says so calmly while she reconnects", () => {
    expect(
      generationWaitCopy("style_sheet", 40_000, { canLeave: true, reconnecting: true }).line,
    ).toContain("Reconnecting");
  });

  test("has no em or en dashes in any stage", () => {
    for (const kind of ["look", "style_sheet", "photo_preview"] as const) {
      for (const ms of [0, 30_000, 100_000, 150_000, 250_000, 600_000]) {
        for (const canLeave of [true, false]) {
          const { stage, line } = generationWaitCopy(kind, ms, { canLeave });
          expect(`${stage}${line}`).not.toMatch(/[–—]/);
        }
      }
    }
  });
});

describe("reaping a job whose server was ended mid-generation", () => {
  const stale = () => job({ deadline_at: new Date(NOW - 60_000).toISOString() });

  test("reaps once per sighting window, then refreshes her rows and credits", async () => {
    const calls: string[] = [];
    const reaper = createStaleJobReaper({
      reap: async () => {
        calls.push("reap");
        return { available: true, reaped: 1 };
      },
      afterReap: () => calls.push("refresh"),
    });
    await reaper.consider([stale(), null], NOW, NOW);
    await reaper.consider([stale()], NOW, NOW + 1_000);
    expect(calls).toEqual(["reap", "refresh"]);
  });

  test("a job still inside its grace, or settled, is left alone", async () => {
    const calls: string[] = [];
    const reaper = createStaleJobReaper({
      reap: async () => {
        calls.push("reap");
        return { available: true, reaped: 0 };
      },
      afterReap: () => calls.push("refresh"),
    });
    await reaper.consider(
      [job(), job({ id: "done", status: "succeeded", deadline_at: "2026-10-01T00:00:00Z" })],
      NOW,
      NOW,
    );
    expect(calls).toEqual([]);
  });

  test("a failed reap is tried again after a backoff, not on every sighting (M4)", async () => {
    let attempts = 0;
    let refreshes = 0;
    const reaper = createStaleJobReaper({
      reap: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("offline");
        return { available: true, reaped: 1 };
      },
      afterReap: () => {
        refreshes += 1;
      },
    });
    await reaper.consider([stale()], NOW, NOW);
    await reaper.consider([stale()], NOW, NOW + 5_000);
    expect(attempts).toBe(1);
    await reaper.consider([stale()], NOW, NOW + REAP_BACKOFF_MS[0]);
    expect(attempts).toBe(2);
    // Her rows are refreshed after every attempt, the failed one included.
    expect(refreshes).toBe(2);
  });

  test("is bounded: a reap that keeps failing stops after the last attempt (M4)", async () => {
    let attempts = 0;
    const reaper = createStaleJobReaper({
      reap: async () => {
        attempts += 1;
        throw new Error("the server function keeps failing");
      },
      afterReap: () => {},
    });
    // An hour of sightings, every 5 s.
    for (let t = 0; t <= 3_600_000; t += 5_000) await reaper.consider([stale()], NOW, NOW + t);
    expect(attempts).toBe(MAX_REAP_ATTEMPTS);
    expect(reaper.attemptsFor("job-1")).toBe(MAX_REAP_ATTEMPTS);
  });

  test("nothing to reap means the server still sees it alive: it is shown as running (M3)", async () => {
    const reaper = createStaleJobReaper({
      reap: async () => ({ available: true, reaped: 0 }),
      afterReap: () => {},
    });
    expect(isJobInProgress(stale(), NOW, reaper.isAlive)).toBe(false);
    await reaper.consider([stale()], NOW, NOW);
    expect(reaper.isAlive("job-1")).toBe(true);
    expect(isJobInProgress(stale(), NOW, reaper.isAlive)).toBe(true);
  });

  test("leaving the page and coming back does not start the count again", async () => {
    let attempts = 0;
    const memory = createReapMemory({ storage: () => null });
    const reapers = () =>
      createStaleJobReaper({
        reap: async () => {
          attempts += 1;
          throw new Error("the server function keeps failing");
        },
        afterReap: () => {},
        memory,
      });
    // She leaves and returns every 10 minutes for an hour: a new page each time.
    for (let visit = 0; visit < 6; visit += 1) {
      const reaper = reapers();
      const at = NOW + visit * 600_000;
      for (let t = 0; t <= 300_000; t += 5_000) await reaper.consider([stale()], NOW, at + t);
    }
    expect(attempts).toBe(MAX_REAP_ATTEMPTS);
  });

  test("a reload keeps the count and what the server said, per job", async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    const first = createStaleJobReaper({
      reap: async () => ({ available: true, reaped: 0 }),
      afterReap: () => {},
      memory: createReapMemory({ storage: () => storage }),
    });
    await first.consider([stale()], NOW, NOW);
    expect(first.isAlive("job-1")).toBe(true);

    let calls = 0;
    const afterReload = createStaleJobReaper({
      reap: async () => {
        calls += 1;
        return { available: true, reaped: 0 };
      },
      afterReap: () => {},
      memory: createReapMemory({ storage: () => storage }),
    });
    expect(afterReload.isAlive("job-1")).toBe(true);
    expect(afterReload.attemptsFor("job-1")).toBe(1);
    // Still inside its backoff: not asked again.
    await afterReload.consider([stale()], NOW, NOW + 5_000);
    expect(calls).toBe(0);
    // Another job has its own count.
    expect(afterReload.attemptsFor("job-2")).toBe(0);
  });

  test("while the migration is missing the reaper's answer proves nothing", async () => {
    const reaper = createStaleJobReaper({
      reap: async () => ({ available: false, reaped: 0 }),
      afterReap: () => {},
    });
    await reaper.consider([stale()], NOW, NOW);
    expect(reaper.isAlive("job-1")).toBe(false);
  });
});

describe("telling her how her own job ended (after she left)", () => {
  test("a refunded failure says the credit is back", () => {
    expect(
      generationFailureNotice(
        job({ status: "failed", error_code: "deadline_exceeded", credit_state: "refunded" }),
      ),
    ).toBe("Mila couldn't finish your look. Your credit is back.");
  });

  test("a failure without a refund never promises one", () => {
    const notice = generationFailureNotice(job({ status: "failed", error_code: "x" }));
    expect(notice).toBe("Mila couldn't finish your look. Please try again.");
  });

  test("delivered-but-unsaved is not a failure and offers no refund (N7)", () => {
    expect(
      generationFailureNotice(job({ status: "failed", error_code: PERSIST_FAILED_DELIVERED })),
    ).toBeNull();
  });

  test("running and succeeded rows have nothing to report", () => {
    expect(generationFailureNotice(job())).toBeNull();
    expect(generationFailureNotice(job({ status: "succeeded" }))).toBeNull();
  });

  test("names the right thing for each kind, with no em or en dashes", () => {
    for (const [kind, noun] of [
      ["style_sheet", "style sheet"],
      ["photo_preview", "portrait"],
    ] as const) {
      const notice = generationFailureNotice(
        job({ kind, status: "failed", error_code: "x", credit_state: "refunded" }),
      );
      expect(notice).toContain(noun);
      expect(notice).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("a request this page already heard back from", () => {
  test("is remembered as answered, so a stale running row is not shown as still running", () => {
    const ledger = createGenerationRequestLedger({ storage: () => null });
    const id = ledger.begin(USER, "look", "a");
    expect(ledger.answered(id)).toBe(false);
    ledger.settle(USER, "look", id);
    expect(ledger.answered(id)).toBe(true);
  });
});

describe("round 5 (N-3): a save never stores a guessed vibe", () => {
  const unconfirmed = {
    headline: "x",
    vibe: "Brunch",
    weatherLabel: "24°C Sunny (Manila)",
    askedConfirmed: false,
  };

  test("a confirmed look is saved as it is, with no read", async () => {
    let reads = 0;
    const look = { ...unconfirmed, askedConfirmed: true };
    await expect(
      settleLookForSave(look, async () => {
        reads += 1;
        return { asked: { vibe: "x", weatherLabel: "y" }, confirmed: true };
      }),
    ).resolves.toEqual(look);
    expect(reads).toBe(0);
  });

  test("an unconfirmed look is confirmed first, and saved with what its row says", async () => {
    await expect(
      settleLookForSave(unconfirmed, async () => ({
        asked: { vibe: "Date Night", weatherLabel: "19°C Rain (Lisbon)" },
        confirmed: true,
      })),
    ).resolves.toEqual({
      ...unconfirmed,
      vibe: "Date Night",
      weatherLabel: "19°C Rain (Lisbon)",
      askedConfirmed: true,
    });
  });

  test("still unconfirmed: nothing to save (the page refuses, never saves the guess)", async () => {
    await expect(
      settleLookForSave(unconfirmed, async () => ({
        asked: { vibe: "Brunch", weatherLabel: "24°C Sunny (Manila)" },
        confirmed: false,
      })),
    ).resolves.toBeNull();
  });
});

describe("round 5 (N-2): the look on screen is known the moment it is set", () => {
  test("set and read synchronously, with no render in between", () => {
    const mark = createLookMark();
    expect(mark.jobId()).toBeNull();
    mark.set({ jobId: "job-a" });
    expect(mark.jobId()).toBe("job-a");
    mark.set(null);
    expect(mark.jobId()).toBeNull();
    mark.set({});
    expect(mark.jobId()).toBeNull();
  });

  test("a look that lands in the last moment of the check answers the press", () => {
    const mark = createLookMark();
    const shownBefore = mark.jobId();
    // Her own look lands while the check's read is finishing.
    mark.set({ jobId: "job-a" });
    expect(lookAnswersPress({ shownBefore, shownNow: mark.jobId(), herJobIds: [] })).toBe(true);
  });
});

describe("round 5 (m-3): an answer that is not Mila's is a lost answer, never a refusal", () => {
  const answer = (status: number, headers: Record<string, string>, body = "") =>
    (async () => new Response(body, { status, headers })) as FetchLike;

  test("a gateway page (502, 503, 504) keeps the id", async () => {
    for (const status of [502, 503, 504]) {
      const guarded = guardGenerationFetch(
        answer(status, { "content-type": "text/html" }, "<html>Bad gateway</html>"),
      );
      const error = await guarded("https://mila.test/_serverFn/x").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LostAnswerError);
      expect(isUnknownGenerationOutcome(error)).toBe(true);
      // Never the page's raw text.
      expect(String((error as Error).message)).not.toContain("<html>");
    }
  });

  test("any 5xx without Mila's own error shape keeps the id", async () => {
    const guarded = guardGenerationFetch(
      answer(500, { "content-type": "application/json" }, '{"error":"A server error"}'),
    );
    await expect(guarded("https://mila.test/_serverFn/x")).rejects.toBeInstanceOf(LostAnswerError);
  });

  test("Mila's own answers pass through: a refusal she sent stays a refusal", async () => {
    const own = guardGenerationFetch(
      answer(500, { "content-type": "application/json", "x-tss-serialized": "true" }, "{}"),
    );
    await expect(own("https://mila.test/_serverFn/x")).resolves.toMatchObject({ status: 500 });
    const ok = guardGenerationFetch(
      answer(200, { "content-type": "application/json", "x-tss-serialized": "true" }, "{}"),
    );
    await expect(ok("https://mila.test/_serverFn/x")).resolves.toMatchObject({ status: 200 });
  });

  test("a lost answer is told calmly, with no raw text and no dashes", () => {
    for (const kind of ["look", "style_sheet", "photo_preview"] as const) {
      const notice = lostAnswerNotice(kind);
      expect(notice).toContain("won't be charged twice");
      expect(notice).not.toMatch(/[\u2013\u2014]|Failed to fetch|<|Error/);
    }
  });

  test("a refusal because her session is reconnecting is told calmly too", () => {
    expect(isSessionRefusal(new Error("Unauthorized: No authorization header provided"))).toBe(
      true,
    );
    expect(isSessionRefusal(new MemberSessionUnavailableError())).toBe(true);
    expect(isSessionRefusal(new Error("Mila couldn't compose a look this time."))).toBe(false);
  });
});

describe("round 5 (m-4): look_generated fires once per job, never for a replay", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  }

  test("a fresh job is counted once, with its own vibe", () => {
    const tracked = createTrackedJobs({ storage: () => null });
    expect(lookEventFor({ jobId: "job-a", replayed: false, vibe: "Brunch", tracked })).toEqual({
      vibe: "Brunch",
    });
    expect(lookEventFor({ jobId: "job-a", replayed: false, vibe: "Brunch", tracked })).toBeNull();
  });

  test("a server replay or an in-flight attach is never counted", () => {
    const tracked = createTrackedJobs({ storage: () => null });
    expect(lookEventFor({ jobId: "job-a", replayed: true, vibe: "Brunch", tracked })).toBeNull();
    // ...and does not use up the job's one count either.
    expect(lookEventFor({ jobId: "job-a", replayed: false, vibe: "Brunch", tracked })).toEqual({
      vibe: "Brunch",
    });
  });

  test("counted once per tab, through a reload", () => {
    const storage = memoryStorage();
    const first = createTrackedJobs({ storage: () => storage });
    expect(lookEventFor({ jobId: "job-a", vibe: "Brunch", tracked: first })).not.toBeNull();
    const afterReload = createTrackedJobs({ storage: () => storage });
    expect(lookEventFor({ jobId: "job-a", vibe: "Brunch", tracked: afterReload })).toBeNull();
  });

  test("before jobs are live (no job id) every answer is a new look", () => {
    const tracked = createTrackedJobs({ storage: () => null });
    expect(lookEventFor({ jobId: null, vibe: "Brunch", tracked })).toEqual({ vibe: "Brunch" });
    expect(lookEventFor({ jobId: null, vibe: "Brunch", tracked })).toEqual({ vibe: "Brunch" });
  });
});
