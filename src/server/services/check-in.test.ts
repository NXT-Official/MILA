import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import type { AiResult } from "@/lib/ai.server";
import type { withAiCredit } from "@/lib/credits.server";
import { INSUFFICIENT_CREDITS } from "@/lib/credits";
import {
  GenerationDeliveredUnsavedError,
  GenerationInFlightError,
  createAvailabilityCache,
  type GenerationJobDeps,
} from "@/lib/generation-jobs.server";
import {
  consumeRateLimit,
  releaseRateLimit,
  type RateLimitPolicy,
  type RateLimitReleaseStore,
  type RateLimitStore,
} from "@/lib/rate-limit.server";
import { MemoryGenerationJobStore } from "../../../tests/helpers/memory-generation-job-store";
import { CHECK_IN_SYSTEM_PROMPT, CHECK_IN_TOOL } from "./body-read";
import {
  CheckInInput,
  getCheckInStatusForUser,
  runCheckInForUser,
  type CheckInDeps,
} from "./check-in";
import type { FreeCheckInSlot } from "./free-check-in-slot.server";

const USER = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
const REQ_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const REQ_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const NOON = Date.parse("2026-10-07T12:00:00.000Z");
const TODAY = "2026-10-07";
/** The rate-limit window's end exactly as PostgREST returns it (microseconds kept). */
const RESET_AT = "2026-10-07T13:00:00.123456+00:00";
const RATE_KEY = `ai:checkIn:${USER}`;

// Distinctive base64 so a leak of either photo is easy to find.
const FACE = "ZmFjZS1waG90by1ieXRlcy1mb3ItdGhlLWNoZWNrLWlu";
const BODY = "Ym9keS1waG90by1ieXRlcy1mb3ItdGhlLWNoZWNrLWlu";
const OTHER_FACE = "b3RoZXItZmFjZS1waG90by1ieXRlcw==";

const reply = (over: Record<string, unknown> = {}): AiResult => ({
  ok: true,
  args: {
    skinDepth: "Medium",
    hairColor: "Dark brown",
    hairLength: "Long",
    silhouette: "Pear",
    faceVisible: true,
    bodyFullLength: true,
    ...over,
  },
});

type AiCall = { messages: Array<Record<string, unknown>>; tool: unknown; options: unknown };

/** Answers each call with the next scripted reply (or promise of one). */
function scriptedAi(replies: Array<AiResult | Promise<AiResult>>) {
  const calls: AiCall[] = [];
  const ai = (async (messages: AiCall["messages"], tool: unknown, _caller: unknown, options) => {
    calls.push({ messages, tool, options });
    const next = replies.shift();
    if (!next) throw new Error("scriptedAi: no scripted reply left");
    return next;
  }) as NonNullable<CheckInDeps["ai"]>;
  return { ai, calls };
}

/** check_rate_limit + release_rate_limit over one in-memory window. */
function memoryRateLimit() {
  const buckets = new Map<string, { count: number; expiresAt: string }>();
  const policies: RateLimitPolicy[] = [];
  const releases: Array<[string, string]> = [];
  const store: RateLimitStore = async (key, policy) => {
    const bucket = buckets.get(key) ?? { count: 0, expiresAt: RESET_AT };
    buckets.set(key, bucket);
    if (bucket.count + 1 > policy.limit) {
      return { allowed: false, remaining: 0, reset_at: bucket.expiresAt, retry_after_seconds: 900 };
    }
    bucket.count += 1;
    return {
      allowed: true,
      remaining: policy.limit - bucket.count,
      reset_at: bucket.expiresAt,
      retry_after_seconds: 0,
    };
  };
  const releaseStore: RateLimitReleaseStore = async (key, resetAt) => {
    releases.push([key, resetAt]);
    const bucket = buckets.get(key);
    if (!bucket || bucket.expiresAt !== resetAt) return false;
    bucket.count = Math.max(0, bucket.count - 1);
    return true;
  };
  return {
    rateLimit: (key: string, policy: RateLimitPolicy) => {
      policies.push(policy);
      return consumeRateLimit(key, policy, store);
    },
    releaseRateLimit: (key: string, resetAt: string | Date) =>
      releaseRateLimit(key, resetAt, releaseStore),
    used: (key: string) => buckets.get(key)?.count ?? 0,
    policies,
    releases,
  };
}

/** user_entitlements.free_check_in_on, in memory. */
function memoryFreeSlot() {
  const state = { day: null as string | null, claims: 0, releases: 0, days: [] as string[] };
  const slotFor = (_userId: string, today: string): FreeCheckInSlot => {
    state.days.push(today);
    return {
      claim: async () => {
        state.claims += 1;
        if (state.day === null || state.day < today) {
          state.day = today;
          return true;
        }
        return false;
      },
      release: async () => {
        state.releases += 1;
        if (state.day === today) state.day = null;
      },
    };
  };
  return { state, slotFor };
}

function setup(options: { daily?: number; purchased?: number } = {}) {
  const now = () => NOON;
  const store = new MemoryGenerationJobStore(now);
  store.seed(USER, options.daily ?? 0, options.purchased ?? 5);
  const rate = memoryRateLimit();
  const free = memoryFreeSlot();
  const legacy = { charges: 0, refunds: 0 };
  const withCredit: typeof withAiCredit = async (_s, _u, produce, opts) => {
    legacy.charges += 1;
    const value = await produce();
    if (opts?.refundIf?.(value)) legacy.refunds += 1;
    return value;
  };
  const jobs: GenerationJobDeps = {
    store,
    availability: createAvailabilityCache(60_000),
    now,
    // An attached request polls on real (1 ms) ticks with the clock held at
    // noon, so the job it waits for is never past its deadline.
    sleep: () => Bun.sleep(1),
    pollMs: 1_000,
  };
  const available = { value: true, asked: 0 };
  const deps = (ai: CheckInDeps["ai"], over: Partial<CheckInDeps> = {}): CheckInDeps => ({
    ai,
    isAiConfigured: () => true,
    available: async () => {
      available.asked += 1;
      return available.value;
    },
    rateLimit: rate.rateLimit,
    releaseRateLimit: rate.releaseRateLimit,
    freeSlot: free.slotFor,
    withCredit,
    dailyAllowance: async () => 0,
    jobs,
    now,
    ...over,
  });
  return { store, rate, free, legacy, deps, available };
}

const member = {} as never;
const both = (clientRequestId?: string) => ({
  faceImageBase64: FACE,
  bodyImageBase64: BODY,
  ...(clientRequestId ? { clientRequestId } : {}),
});

let logSpies: Array<Mock<(...args: unknown[]) => void>> = [];
beforeEach(() => {
  logSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    spyOn(console, method).mockImplementation(() => {}),
  );
});
afterEach(() => {
  for (const spy of logSpies) spy.mockRestore();
});
const loggedText = () =>
  logSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(" "))
    .join("\n");

describe("Today's check-in", () => {
  test("one AI call reads skin depth, hair colour, hair length and silhouette", async () => {
    const { deps } = setup();
    const { ai, calls } = scriptedAi([reply()]);

    const out = await runCheckInForUser(member, USER, both(REQ_A), deps(ai));

    expect(out).toEqual({
      success: true,
      read: {
        skinDepth: "Medium",
        hairColor: "Dark brown",
        hairLength: "Long",
        silhouette: "Pear",
        bodyPhotoUsable: true,
      },
      jobId: expect.any(String),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe(CHECK_IN_TOOL);
    expect(calls[0].options).toEqual({ timeoutMs: 110_000 });
    const [system, user] = calls[0].messages as Array<{ role: string; content: unknown }>;
    expect(system).toEqual({ role: "system", content: CHECK_IN_SYSTEM_PROMPT });
    const parts = user.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.filter((p) => p.type === "image_url").map((p) => p.image_url?.url)).toEqual([
      `data:image/jpeg;base64,${FACE}`,
      `data:image/jpeg;base64,${BODY}`,
    ]);
  });

  test("the tool and prompt never ask for season, undertone, gender, height or weight", () => {
    const forbidden = /season|undertone|gender|height|weight/i;
    const props = (CHECK_IN_TOOL.function.parameters as { properties: Record<string, unknown> })
      .properties;
    expect(Object.keys(props).join(" ")).not.toMatch(forbidden);
    expect(JSON.stringify(CHECK_IN_TOOL)).not.toMatch(forbidden);
    // The prompt names them once, only to forbid them.
    const refusal =
      "Never judge or mention season, undertone, gender, age, height, weight or attractiveness.";
    expect(CHECK_IN_SYSTEM_PROMPT).toContain(refusal);
    expect(CHECK_IN_SYSTEM_PROMPT.replace(refusal, "")).not.toMatch(forbidden);
  });

  test("the first check-in of the UTC day claims the free slot and charges nothing", async () => {
    const { deps, store, free } = setup({ daily: 0, purchased: 5 });
    const { ai } = scriptedAi([reply()]);

    const out = await runCheckInForUser(member, USER, both(REQ_A), deps(ai));

    expect(out.success).toBe(true);
    expect(free.state.days).toContain(TODAY);
    expect(free.state.day).toBe(TODAY);
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
    expect(store.rows[0]).toMatchObject({ kind: "check_in", credit_state: "none" });
  });

  test("the second check-in that day charges one credit", async () => {
    const { deps, store } = setup({ daily: 0, purchased: 5 });
    const { ai } = scriptedAi([reply(), reply({ hairColor: "Auburn" })]);

    await runCheckInForUser(member, USER, both(REQ_A), deps(ai));
    const second = await runCheckInForUser(member, USER, both(REQ_B), deps(ai));

    expect(second).toMatchObject({ success: true, read: { hairColor: "Auburn" } });
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 4 });
    expect(store.rows[1]).toMatchObject({ kind: "check_in", credit_state: "charged" });
  });

  test("a failed free check-in gives the free slot back", async () => {
    const { deps, store, free } = setup({ daily: 0, purchased: 5 });
    const { ai } = scriptedAi([{ ok: false, status: 503 }, reply()]);

    const failed = await runCheckInForUser(member, USER, both(REQ_A), deps(ai));
    expect(failed).toEqual({ success: false, error: "CHECK_IN_FAILED" });
    expect(free.state.day).toBeNull();
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });

    // So the next one is still today's free check-in.
    const next = await runCheckInForUser(member, USER, both(REQ_B), deps(ai));
    expect(next.success).toBe(true);
    expect(store.rows[1]).toMatchObject({ credit_state: "none" });
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
  });

  test("a failed paid check-in refunds and releases the hourly slot", async () => {
    const { deps, store, rate } = setup({ daily: 0, purchased: 5 });
    const { ai } = scriptedAi([reply(), { ok: false, status: 503 }]);

    await runCheckInForUser(member, USER, both(REQ_A), deps(ai));
    const failed = await runCheckInForUser(member, USER, both(REQ_B), deps(ai));

    expect(failed).toEqual({ success: false, error: "CHECK_IN_FAILED" });
    expect(store.rows[1]).toMatchObject({ status: "failed", credit_state: "refunded" });
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
    // The provider generated nothing: the slot goes back, once, to the window
    // it was charged in, with reset_at passed through untouched.
    expect(rate.releases).toEqual([[RATE_KEY, RESET_AT]]);
    expect(rate.used(RATE_KEY)).toBe(1);
  });

  test("the sixth check-in in an hour answers CHECK_IN_RATE_LIMITED before any AI call", async () => {
    const { deps, store, rate } = setup({ daily: 0, purchased: 10 });
    const { ai, calls } = scriptedAi([reply(), reply(), reply(), reply(), reply()]);

    for (let i = 0; i < 5; i += 1) {
      const out = await runCheckInForUser(member, USER, both(crypto.randomUUID()), deps(ai));
      expect(out.success).toBe(true);
    }
    const sixth = await runCheckInForUser(member, USER, both(crypto.randomUUID()), deps(ai));

    expect(sixth).toEqual({ success: false, error: "CHECK_IN_RATE_LIMITED" });
    expect(calls).toHaveLength(5);
    expect(store.rows).toHaveLength(5);
    expect(rate.policies.every((p) => p.limit === 5 && p.windowSeconds === 3600)).toBe(true);
  });

  test("50 garbage-base64 check-ins in an hour reach the provider only 5 times (M-2)", async () => {
    const { deps, store, rate } = setup({ daily: 0, purchased: 5 });
    // The provider refuses a non-image with a 400: a refusal she caused.
    const { ai, calls } = scriptedAi(
      Array.from({ length: 50 }, () => ({ ok: false as const, status: 400 })),
    );

    const answers: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const out = await runCheckInForUser(
        member,
        USER,
        { faceImageBase64: "bm90LWFuLWltYWdlLWF0LWFsbA==", clientRequestId: crypto.randomUUID() },
        deps(ai),
      );
      answers.push(out.success ? "success" : out.error);
    }

    expect(calls).toHaveLength(5);
    expect(answers.filter((a) => a === "CHECK_IN_FAILED")).toHaveLength(5);
    expect(answers.filter((a) => a === "CHECK_IN_RATE_LIMITED")).toHaveLength(45);
    expect(rate.releases).toEqual([]);
    expect(rate.used(RATE_KEY)).toBe(5);
    // Every failure is still refunded (or its free slot handed back).
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
  });

  test("photos never appear in the job input, the result or a log line", async () => {
    const { deps, store } = setup({ daily: 0, purchased: 5 });
    const { ai } = scriptedAi([
      reply(),
      { ok: false, status: 503 },
      reply({ faceVisible: false }),
      reply({ skinDepth: "Turquoise" }),
    ]);

    for (const id of [REQ_A, REQ_B, crypto.randomUUID(), crypto.randomUUID()]) {
      await runCheckInForUser(member, USER, both(id), deps(ai));
    }

    const stored = JSON.stringify(store.rows);
    expect(stored).not.toContain(FACE);
    expect(stored).not.toContain(BODY);
    expect(stored).not.toContain("base64");
    expect(store.rows[0].input).toEqual({
      photos: ["face", "body"],
      digest: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    const logs = loggedText();
    expect(logs).not.toContain(FACE);
    expect(logs).not.toContain(BODY);
    expect(logs).not.toContain("base64");
  });

  test("an unseen face answers CHECK_IN_PHOTO_UNUSABLE and refunds", async () => {
    const { deps, store, rate } = setup({ daily: 0, purchased: 5 });
    const { ai } = scriptedAi([reply(), reply({ faceVisible: false })]);

    await runCheckInForUser(member, USER, both(REQ_A), deps(ai));
    const out = await runCheckInForUser(member, USER, both(REQ_B), deps(ai));

    expect(out).toEqual({ success: false, error: "CHECK_IN_PHOTO_UNUSABLE" });
    expect(store.rows[1]).toMatchObject({
      status: "failed",
      credit_state: "refunded",
      error_code: "CHECK_IN_PHOTO_UNUSABLE",
    });
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
    // R-2 amended: the provider was paid for that judgement, so the slot stays spent.
    expect(rate.releases).toEqual([]);
    expect(rate.used(RATE_KEY)).toBe(2);
  });

  test("no body photo gives silhouette null and bodyPhotoUsable null", async () => {
    const { deps, store } = setup();
    const { ai, calls } = scriptedAi([reply({ silhouette: "Pear", bodyFullLength: true })]);

    const out = await runCheckInForUser(
      member,
      USER,
      { faceImageBase64: FACE, clientRequestId: REQ_A },
      deps(ai),
    );

    expect(out).toMatchObject({
      success: true,
      read: { silhouette: null, bodyPhotoUsable: null },
    });
    const parts = (calls[0].messages[1] as { content: Array<{ type: string }> }).content;
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(1);
    expect(store.rows[0].input).toMatchObject({ photos: ["face"] });
  });

  test("a body photo that is not full length gives silhouette null and bodyPhotoUsable false", async () => {
    const { deps } = setup();
    const { ai } = scriptedAi([reply({ silhouette: "Hourglass", bodyFullLength: false })]);

    const out = await runCheckInForUser(member, USER, both(REQ_A), deps(ai));

    expect(out).toMatchObject({
      success: true,
      read: { silhouette: null, bodyPhotoUsable: false, hairColor: "Dark brown" },
    });
  });

  test("a missing Wave D migration answers CHECK_IN_UNAVAILABLE before any charge", async () => {
    const { deps, store, rate, free, available } = setup();
    available.value = false;
    const { ai, calls } = scriptedAi([reply()]);

    const out = await runCheckInForUser(member, USER, both(REQ_A), deps(ai));

    expect(out).toEqual({ success: false, error: "CHECK_IN_UNAVAILABLE" });
    expect(calls).toHaveLength(0);
    expect(store.calls.start).toBe(0);
    expect(rate.used(RATE_KEY)).toBe(0);
    expect(free.state.claims).toBe(0);
  });

  test("a photo over 1,800,000 characters is refused before any AI call", async () => {
    const { deps, store, rate } = setup();
    const { ai, calls } = scriptedAi([reply(), reply()]);
    const huge = "A".repeat(1_800_001);

    const bigFace = await runCheckInForUser(
      member,
      USER,
      { faceImageBase64: huge, clientRequestId: REQ_A },
      deps(ai),
    );
    const bigBody = await runCheckInForUser(
      member,
      USER,
      { faceImageBase64: FACE, bodyImageBase64: huge, clientRequestId: REQ_B },
      deps(ai),
    );

    expect(bigFace).toEqual({ success: false, error: "CHECK_IN_PHOTO_TOO_LARGE" });
    expect(bigBody).toEqual({ success: false, error: "CHECK_IN_PHOTO_TOO_LARGE" });
    expect(calls).toHaveLength(0);
    expect(store.calls.start).toBe(0);
    expect(rate.used(RATE_KEY)).toBe(0);
  });

  test("the same clientRequestId replays with no AI call", async () => {
    const { deps, store, rate } = setup({ daily: 0, purchased: 5 });
    const { ai, calls } = scriptedAi([reply()]);

    const first = await runCheckInForUser(member, USER, both(REQ_A), deps(ai));
    const replay = await runCheckInForUser(member, USER, both(REQ_A), deps(ai));

    expect(replay).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
    // The replay made no provider call: its own slot goes back, the first's stays.
    expect(rate.releases).toEqual([[RATE_KEY, RESET_AT]]);
    expect(rate.used(RATE_KEY)).toBe(1);
  });

  test("a replay of a check-in delivered but never stored passes DELIVERED_NOT_SAVED through, keeps its hourly slot, and is not reported as a failure", async () => {
    const { deps, store, rate } = setup({ daily: 0, purchased: 5 });
    const { ai, calls } = scriptedAi([reply()]);
    store.failComplete = true;
    const first = await runCheckInForUser(member, USER, both(REQ_A), deps(ai));
    expect(first.success).toBe(true);
    expect(store.rows[0].error_code).toBe("persist_failed_delivered");
    store.failComplete = false;
    const before = { releases: [...rate.releases], balance: store.balance(USER) };

    const err = await runCheckInForUser(member, USER, both(REQ_A), deps(ai)).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(GenerationDeliveredUnsavedError);
    expect(calls).toHaveLength(1);
    expect(rate.releases).toEqual(before.releases);
    expect(rate.used(RATE_KEY)).toBe(2);
    expect(store.balance(USER)).toEqual(before.balance);
    expect(loggedText()).not.toContain("did not finish");
  });

  test("a different photo pair while one is running answers in-flight, never the other photos' result", async () => {
    const { deps, store, rate } = setup({ daily: 0, purchased: 5 });
    let finish: (value: AiResult) => void = () => {};
    const gate = new Promise<AiResult>((resolve) => (finish = resolve));
    const { ai, calls } = scriptedAi([gate]);

    const first = runCheckInForUser(member, USER, both(REQ_A), deps(ai));
    await Bun.sleep(0);
    while (calls.length === 0) await Bun.sleep(1);

    const other = runCheckInForUser(
      member,
      USER,
      { faceImageBase64: OTHER_FACE, bodyImageBase64: BODY, clientRequestId: REQ_B },
      deps(ai),
    );
    await expect(other).rejects.toBeInstanceOf(GenerationInFlightError);

    finish(reply({ hairColor: "Red" }));
    expect(await first).toMatchObject({ success: true, read: { hairColor: "Red" } });
    expect(calls).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
    // The refused request made no call: its slot goes back.
    expect(rate.releases).toEqual([[RATE_KEY, RESET_AT]]);
  });

  test("the same photos from a second request while one is running wait for it and share its read", async () => {
    const { deps, store } = setup({ daily: 0, purchased: 5 });
    let finish: (value: AiResult) => void = () => {};
    const gate = new Promise<AiResult>((resolve) => (finish = resolve));
    const { ai, calls } = scriptedAi([gate]);

    const first = runCheckInForUser(member, USER, both(REQ_A), deps(ai));
    while (calls.length === 0) await Bun.sleep(1);
    const attached = runCheckInForUser(member, USER, both(REQ_B), deps(ai));
    await Bun.sleep(5);
    finish(reply({ hairLength: "Short" }));

    const [a, b] = await Promise.all([first, attached]);
    expect(a).toMatchObject({ success: true, read: { hairLength: "Short" } });
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });

  test("out of credits answers INSUFFICIENT_CREDITS with no AI call and hands the slot back", async () => {
    const { deps, store, rate, free } = setup({ daily: 0, purchased: 0 });
    free.state.day = TODAY;
    const { ai, calls } = scriptedAi([reply()]);

    const out = await runCheckInForUser(member, USER, both(REQ_A), deps(ai));

    expect(out).toEqual({ success: false, error: INSUFFICIENT_CREDITS });
    expect(calls).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
    expect(rate.releases).toEqual([[RATE_KEY, RESET_AT]]);
  });

  test("an unconfigured AI provider answers CONFIG_MISSING_API_KEY before anything else", async () => {
    const { deps, store, rate, available } = setup();
    const { ai, calls } = scriptedAi([reply()]);

    const out = await runCheckInForUser(
      member,
      USER,
      both(REQ_A),
      deps(ai, { isAiConfigured: () => false }),
    );

    expect(out).toEqual({ success: false, error: "CONFIG_MISSING_API_KEY" });
    expect(calls).toHaveLength(0);
    expect(available.asked).toBe(0);
    expect(store.calls.start).toBe(0);
    expect(rate.used(RATE_KEY)).toBe(0);
  });

  test("a reply outside the tool is refused, refunded, and the slot stays spent", async () => {
    const { deps, store, rate } = setup({ daily: 0, purchased: 5 });
    const { ai } = scriptedAi([reply(), reply({ hairColor: "Teal" })]);

    await runCheckInForUser(member, USER, both(REQ_A), deps(ai));
    const out = await runCheckInForUser(member, USER, both(REQ_B), deps(ai));

    expect(out).toEqual({ success: false, error: "CHECK_IN_FAILED" });
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
    expect(rate.releases).toEqual([]);
  });

  test("with generation jobs missing: the free slot first, then withAiCredit, refunds on failure", async () => {
    const { deps, store, legacy, free } = setup({ daily: 0, purchased: 5 });
    store.missing = true;
    const { ai } = scriptedAi([reply(), reply({ faceVisible: false }), reply()]);

    const first = await runCheckInForUser(member, USER, both(REQ_A), deps(ai));
    expect(first).toMatchObject({ success: true });
    expect(first).not.toHaveProperty("jobId");
    expect(free.state.day).toBe(TODAY);
    expect(legacy.charges).toBe(0);

    const unusable = await runCheckInForUser(member, USER, both(REQ_B), deps(ai));
    expect(unusable).toEqual({ success: false, error: "CHECK_IN_PHOTO_UNUSABLE" });
    expect(legacy).toEqual({ charges: 1, refunds: 1 });

    const paid = await runCheckInForUser(member, USER, both(crypto.randomUUID()), deps(ai));
    expect(paid.success).toBe(true);
    expect(legacy).toEqual({ charges: 2, refunds: 1 });
  });

  test("with generation jobs missing, a failed free check-in hands its slot back", async () => {
    const { deps, store, free, legacy } = setup();
    store.missing = true;
    const { ai } = scriptedAi([{ ok: false, status: 500 }]);

    const out = await runCheckInForUser(member, USER, both(REQ_A), deps(ai));

    expect(out).toEqual({ success: false, error: "CHECK_IN_FAILED" });
    expect(free.state.day).toBeNull();
    expect(legacy.charges).toBe(0);
  });
});

describe("CheckInInput", () => {
  test("accepts a face photo, an optional body photo and an optional request id", () => {
    expect(CheckInInput.parse({ faceImageBase64: FACE })).toEqual({ faceImageBase64: FACE });
    expect(CheckInInput.parse(both(REQ_A))).toEqual(both(REQ_A));
    expect(CheckInInput.safeParse({ faceImageBase64: "" }).success).toBe(false);
    expect(CheckInInput.safeParse({ ...both(), clientRequestId: "nope" }).success).toBe(false);
  });

  test("a photo far past the cap is refused with plain copy", () => {
    const parsed = CheckInInput.safeParse({ faceImageBase64: "A".repeat(15_000_001) });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("That photo is too large. Try another one.");
  });
});

type TableResult = { data?: unknown; error?: { code?: string; message: string } | null };

/** A member client answering one read per table. */
function memberClient(tables: Record<string, TableResult>) {
  const reads: Array<{ table: string; select: string; filters: Array<[string, unknown]> }> = [];
  return {
    reads,
    client: {
      from(table: string) {
        const read = { table, select: "", filters: [] as Array<[string, unknown]> };
        reads.push(read);
        const chain = {
          select(columns: string) {
            read.select = columns;
            return chain;
          },
          eq(column: string, value: unknown) {
            read.filters.push([column, value]);
            return chain;
          },
          maybeSingle: async () => {
            const result = tables[table] ?? { data: null };
            return { data: result.data ?? null, error: result.error ?? null };
          },
        };
        return chain;
      },
    } as never,
  };
}

const MISSING = { code: "42703", message: "column does not exist" };

describe("getCheckInStatusForUser", () => {
  const now = () => NOON;

  test("an unclaimed day and an unused founding scan are both free", async () => {
    const { client, reads } = memberClient({
      user_entitlements: { data: { free_check_in_on: null } },
      profiles: {
        data: { hair_color: null, last_check_in_at: null, founding_body_read_at: null },
      },
    });

    expect(await getCheckInStatusForUser(client, USER, { now })).toEqual({
      available: true,
      freeToday: true,
      checkInCost: 0,
      bodyScan: { available: true, free: true, cost: 0 },
    });
    expect(reads.find((r) => r.table === "user_entitlements")).toMatchObject({
      select: "free_check_in_on",
      filters: [["user_id", USER]],
    });
  });

  test("a check-in claimed today costs one credit; one claimed yesterday is free again", async () => {
    const extras = {
      data: {
        hair_color: "Auburn",
        last_check_in_at: null,
        founding_body_read_at: "2026-10-01T09:00:00+00:00",
      },
    };
    const today = memberClient({
      user_entitlements: { data: { free_check_in_on: TODAY } },
      profiles: extras,
    });
    expect(await getCheckInStatusForUser(today.client, USER, { now })).toEqual({
      available: true,
      freeToday: false,
      checkInCost: 1,
      bodyScan: { available: true, free: false, cost: 1 },
    });

    const yesterday = memberClient({
      user_entitlements: { data: { free_check_in_on: "2026-10-06" } },
      profiles: extras,
    });
    expect(await getCheckInStatusForUser(yesterday.client, USER, { now })).toMatchObject({
      freeToday: true,
      checkInCost: 0,
    });
  });

  test("unavailable while the migration is missing, and never free", async () => {
    const { client } = memberClient({
      user_entitlements: { error: MISSING },
      profiles: { error: MISSING },
    });

    expect(await getCheckInStatusForUser(client, USER, { now })).toEqual({
      available: false,
      freeToday: false,
      checkInCost: 1,
      bodyScan: { available: false, free: false, cost: 1 },
    });
  });

  test("a failed or empty read never shows anything as free", async () => {
    const { client } = memberClient({
      user_entitlements: { error: { code: "XX000", message: "boom" } },
      profiles: { data: null },
    });

    expect(await getCheckInStatusForUser(client, USER, { now })).toEqual({
      available: false,
      freeToday: false,
      checkInCost: 1,
      bodyScan: { available: false, free: false, cost: 1 },
    });
  });
});
