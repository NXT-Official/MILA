import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AiResult } from "@/lib/ai.server";
import type { withAiCredit } from "@/lib/credits.server";
import { INSUFFICIENT_CREDITS } from "@/lib/credits";
import {
  GenerationDeliveredUnsavedError,
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
import { BODY_SCAN_SYSTEM_PROMPT, BODY_SCAN_TOOL } from "./body-read";
import {
  BodyScanInput,
  bodyScanPricing,
  foundingBodyScanSlot,
  markFoundingBodyReadUsed,
  runBodyScanForUser,
  type BodyScanDeps,
  type FoundingBodyScanSlot,
} from "./body-scan";
import type { ProfileExtras } from "./profile-extras.server";

const USER = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
const REQ_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const REQ_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const NOON = Date.parse("2026-10-07T12:00:00.000Z");
const RESET_AT = "2026-10-07T13:00:00.654321+00:00";
const RATE_KEY = `ai:bodyScan:${USER}`;
const BODY = "Ym9keS1zY2FuLXBob3RvLWJ5dGVzLWZvci1taWxh";
const SPENT_BEFORE = "2026-10-01T09:00:00+00:00";

const fullLength = (silhouette = "Hourglass", bodyFullLength = true): AiResult => ({
  ok: true,
  args: { silhouette, bodyFullLength },
});

const FOUNDING_UNUSED: ProfileExtras = {
  available: true,
  hairColor: null,
  lastCheckInAt: null,
  foundingBodyReadAt: null,
};
const FOUNDING_USED: ProfileExtras = { ...FOUNDING_UNUSED, foundingBodyReadAt: SPENT_BEFORE };
const unavailable = (reason: "missing" | "missing_row" | "error"): ProfileExtras => ({
  available: false,
  reason,
  hairColor: null,
  lastCheckInAt: null,
  foundingBodyReadAt: null,
});

type AiCall = { messages: Array<{ role: string; content: unknown }>; tool: unknown };

function scriptedAi(replies: Array<AiResult | Promise<AiResult>>, onCall?: () => void) {
  const calls: AiCall[] = [];
  const ai = (async (messages: AiCall["messages"], tool: unknown) => {
    calls.push({ messages, tool });
    onCall?.();
    const next = replies.shift();
    if (!next) throw new Error("scriptedAi: no scripted reply left");
    return next;
  }) as NonNullable<BodyScanDeps["ai"]>;
  return { ai, calls };
}

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

/**
 * `profiles.founding_body_read_at` in memory, with the database's semantics:
 * a claim is `UPDATE … WHERE founding_body_read_at IS NULL` (one winner), a
 * release is `SET NULL WHERE founding_body_read_at = <that claim's stamp>`.
 * It deliberately has no guard of its own, so the counters show what the
 * service asked for: a release from a request that never won a claim, or a
 * second release of one claim, is counted, never hidden.
 */
function memoryFounding(initial: string | null = null) {
  const state = {
    at: initial,
    seq: 0,
    wins: 0,
    releases: 0,
    strayReleases: 0,
    doubleReleases: 0,
  };
  const slotFor = (_userId: string): FoundingBodyScanSlot => {
    let stamp: string | null = null;
    let releasedThisClaim = false;
    return {
      claim: async () => {
        if (state.at !== null) return false;
        state.seq += 1;
        stamp = `2026-10-07T12:00:00.${String(state.seq).padStart(3, "0")}Z`;
        state.at = stamp;
        state.wins += 1;
        releasedThisClaim = false;
        return true;
      },
      release: async () => {
        if (!stamp) {
          state.strayReleases += 1;
          return;
        }
        if (releasedThisClaim) state.doubleReleases += 1;
        releasedThisClaim = true;
        state.releases += 1;
        if (state.at === stamp) state.at = null;
      },
    };
  };
  return { state, slotFor };
}

function setup(options: { purchased?: number; extras?: ProfileExtras } = {}) {
  const now = () => NOON;
  const store = new MemoryGenerationJobStore(now);
  store.seed(USER, 0, options.purchased ?? 5);
  const rate = memoryRateLimit();
  const founding = memoryFounding(
    options.extras?.available ? options.extras.foundingBodyReadAt : null,
  );
  // Her Wave D read: a given answer (an unavailable one), or the live column.
  const profile = { extras: options.extras ?? null, reads: 0 };
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
    sleep: () => Bun.sleep(1),
    pollMs: 1_000,
  };
  const deps = (ai: BodyScanDeps["ai"], over: Partial<BodyScanDeps> = {}): BodyScanDeps => ({
    ai,
    isAiConfigured: () => true,
    readExtras: async () => {
      profile.reads += 1;
      if (profile.extras && !profile.extras.available) return profile.extras;
      return { ...FOUNDING_UNUSED, foundingBodyReadAt: founding.state.at };
    },
    rateLimit: rate.rateLimit,
    releaseRateLimit: rate.releaseRateLimit,
    withCredit,
    dailyAllowance: async () => 0,
    foundingSlot: founding.slotFor,
    jobs,
    ...over,
  });
  return { store, rate, profile, founding, legacy, deps };
}

const member = {} as never;
const scan = (clientRequestId?: string) => ({
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

describe("body scan", () => {
  test("one AI call with the body scan tool and her one photo", async () => {
    const { deps } = setup();
    const { ai, calls } = scriptedAi([fullLength("Pear")]);

    const out = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));

    expect(out).toEqual({ success: true, silhouette: "Pear", jobId: expect.any(String) });
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe(BODY_SCAN_TOOL);
    expect(calls[0].messages[0]).toEqual({ role: "system", content: BODY_SCAN_SYSTEM_PROMPT });
    const parts = calls[0].messages[1].content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(parts.filter((p) => p.type === "image_url").map((p) => p.image_url?.url)).toEqual([
      `data:image/jpeg;base64,${BODY}`,
    ]);
  });

  test("the founding scan is claimed before the AI call, kept on success, given back on a refunded failure; the next costs one credit", async () => {
    const { deps, store, founding } = setup({ purchased: 5 });
    const atCall: Array<string | null> = [];
    const { ai } = scriptedAi(
      [{ ok: false, status: 503 }, fullLength("Rectangle"), fullLength()],
      () => atCall.push(founding.state.at),
    );

    const failed = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));
    expect(failed).toEqual({ success: false, error: "BODY_SCAN_FAILED" });
    expect(store.rows[0]).toMatchObject({ kind: "body_scan", credit_state: "none" });
    // Claimed before the provider was asked, handed back once it failed.
    expect(atCall[0]).not.toBeNull();
    expect(founding.state.at).toBeNull();
    expect(founding.state.releases).toBe(1);

    const first = await runBodyScanForUser(member, USER, scan(REQ_B), deps(ai));
    expect(first).toMatchObject({ success: true, silhouette: "Rectangle" });
    expect(store.rows[1]).toMatchObject({ credit_state: "none", status: "succeeded" });
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
    const spentAt = founding.state.at;
    expect(spentAt).not.toBeNull();

    const next = await runBodyScanForUser(member, USER, scan(crypto.randomUUID()), deps(ai));
    expect(next).toMatchObject({ success: true, silhouette: "Hourglass" });
    expect(store.rows[2]).toMatchObject({ credit_state: "charged" });
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 4 });
    expect(founding.state.at).toBe(spentAt);
    expect(founding.state).toMatchObject({ wins: 2, strayReleases: 0, doubleReleases: 0 });
  });

  test("two racing founding scans produce exactly one free (M-1)", async () => {
    const { deps, store, founding } = setup({ purchased: 5 });
    const { ai } = scriptedAi([fullLength("Pear"), fullLength("Apple")]);
    // Both read her founding scan as unused; the second request's read is
    // stale by the time it starts, because the first finished in between.
    let releaseSecondRead: () => void = () => {};
    const secondRead = new Promise<void>((resolve) => (releaseSecondRead = resolve));
    let reads = 0;
    const staleRead = async (): Promise<ProfileExtras> => {
      reads += 1;
      if (reads === 2) await secondRead;
      return FOUNDING_UNUSED;
    };

    const first = runBodyScanForUser(
      member,
      USER,
      scan(REQ_A),
      deps(ai, { readExtras: staleRead }),
    );
    const second = runBodyScanForUser(
      member,
      USER,
      scan(REQ_B),
      deps(ai, { readExtras: staleRead }),
    );
    const a = await first;
    releaseSecondRead();
    const b = await second;

    expect(a).toMatchObject({ success: true, silhouette: "Pear" });
    expect(b).toMatchObject({ success: true, silhouette: "Apple" });
    expect(store.rows.map((r) => r.credit_state)).toEqual(["none", "charged"]);
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 4 });
    expect(founding.state).toMatchObject({ wins: 1, releases: 0, strayReleases: 0 });
  });

  test("two founding scans at the same moment with generation jobs missing: exactly one free (M-4)", async () => {
    const { deps, store, founding, legacy } = setup({ purchased: 5 });
    store.missing = true;
    const { ai } = scriptedAi([fullLength("Pear"), fullLength("Apple")]);

    const [a, b] = await Promise.all([
      runBodyScanForUser(member, USER, scan(REQ_A), deps(ai)),
      runBodyScanForUser(member, USER, scan(REQ_B), deps(ai)),
    ]);

    expect(a.success && b.success).toBe(true);
    expect(founding.state.wins).toBe(1);
    expect(legacy.charges).toBe(1);
    expect(founding.state).toMatchObject({ releases: 0, strayReleases: 0 });
  });

  test("a photo that is not full length answers BODY_SCAN_NOT_FULL_LENGTH and refunds", async () => {
    const { deps, store, rate, founding } = setup({ purchased: 5, extras: FOUNDING_USED });
    const { ai } = scriptedAi([fullLength("Pear", false), fullLength("not_visible", true)]);

    const cropped = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));
    const unseen = await runBodyScanForUser(member, USER, scan(REQ_B), deps(ai));

    expect(cropped).toEqual({ success: false, error: "BODY_SCAN_NOT_FULL_LENGTH" });
    expect(unseen).toEqual({ success: false, error: "BODY_SCAN_NOT_FULL_LENGTH" });
    expect(store.rows.map((r) => r.credit_state)).toEqual(["refunded", "refunded"]);
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
    // A request that lost the founding claim never frees it.
    expect(founding.state).toMatchObject({ at: SPENT_BEFORE, wins: 0, strayReleases: 0 });
    // R-2 amended: both were judged by a paid call, so the slots stay spent.
    expect(rate.releases).toEqual([]);
    expect(rate.used(RATE_KEY)).toBe(2);
  });

  test("a failed paid scan refunds and hands back the hourly slot", async () => {
    const { deps, store, rate } = setup({ purchased: 5, extras: FOUNDING_USED });
    const { ai } = scriptedAi([{ ok: false, status: 429 }]);

    const out = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));

    expect(out).toEqual({ success: false, error: "BODY_SCAN_FAILED" });
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
    expect(rate.releases).toEqual([[RATE_KEY, RESET_AT]]);
    expect(rate.used(RATE_KEY)).toBe(0);
  });

  test("50 garbage-base64 scans in an hour reach the provider only 10 times (M-2)", async () => {
    const { deps, store, rate, founding } = setup({ purchased: 5 });
    // The provider refuses a non-image with a 400: a refusal she caused.
    const { ai, calls } = scriptedAi(
      Array.from({ length: 50 }, () => ({ ok: false as const, status: 400 })),
    );

    const answers: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const out = await runBodyScanForUser(
        member,
        USER,
        { bodyImageBase64: "bm90LWFuLWltYWdlLWF0LWFsbA==", clientRequestId: crypto.randomUUID() },
        deps(ai),
      );
      answers.push(out.success ? "success" : out.error);
    }

    expect(calls).toHaveLength(10);
    expect(answers.filter((a) => a === "BODY_SCAN_FAILED")).toHaveLength(10);
    expect(answers.filter((a) => a === "BODY_SCAN_RATE_LIMITED")).toHaveLength(40);
    expect(rate.releases).toEqual([]);
    expect(rate.used(RATE_KEY)).toBe(10);
    // Each refused founding scan gave its claim back; nothing was charged.
    expect(founding.state.at).toBeNull();
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
  });

  test("an unapplied migration hides the scan: BODY_SCAN_UNAVAILABLE before any charge or slot", async () => {
    const { deps, store, rate, founding } = setup({ extras: unavailable("missing") });
    const { ai, calls } = scriptedAi([fullLength()]);

    const out = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));

    expect(out).toEqual({ success: false, error: "BODY_SCAN_UNAVAILABLE" });
    expect(calls).toHaveLength(0);
    expect(store.calls.start).toBe(0);
    expect(rate.used(RATE_KEY)).toBe(0);
    expect(founding.state.wins).toBe(0);
  });

  test("a failed or rowless profile read never prices a scan as free", async () => {
    for (const reason of ["error", "missing_row"] as const) {
      const { deps, store, rate, founding } = setup({ extras: unavailable(reason) });
      const { ai, calls } = scriptedAi([fullLength()]);

      const out = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));

      expect(out).toEqual({ success: false, error: "BODY_SCAN_FAILED" });
      expect(calls).toHaveLength(0);
      expect(store.calls.start).toBe(0);
      expect(rate.used(RATE_KEY)).toBe(0);
      expect(founding.state.wins).toBe(0);
    }
  });

  test("a founding claim that cannot be made answers BODY_SCAN_FAILED with nothing spent or free", async () => {
    const { deps, store, rate } = setup({ purchased: 5 });
    const { ai, calls } = scriptedAi([fullLength()]);
    const broken: BodyScanDeps["foundingSlot"] = () => ({
      claim: async () => {
        throw new Error("The founding body scan could not be claimed.");
      },
      release: async () => {},
    });

    const out = await runBodyScanForUser(
      member,
      USER,
      scan(REQ_A),
      deps(ai, { foundingSlot: broken }),
    );

    expect(out).toEqual({ success: false, error: "BODY_SCAN_FAILED" });
    expect(calls).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 5 });
    // No provider call was made, so the hourly slot goes back.
    expect(rate.releases).toEqual([[RATE_KEY, RESET_AT]]);
  });

  test("a photo over 1,800,000 characters is refused before any AI call", async () => {
    const { deps, store, rate } = setup();
    const { ai, calls } = scriptedAi([fullLength()]);

    const out = await runBodyScanForUser(
      member,
      USER,
      { bodyImageBase64: "A".repeat(1_800_001), clientRequestId: REQ_A },
      deps(ai),
    );

    expect(out).toEqual({ success: false, error: "BODY_SCAN_PHOTO_TOO_LARGE" });
    expect(calls).toHaveLength(0);
    expect(store.calls.start).toBe(0);
    expect(rate.used(RATE_KEY)).toBe(0);
  });

  test("the eleventh scan in an hour answers BODY_SCAN_RATE_LIMITED before any AI call", async () => {
    const { deps, rate } = setup({ purchased: 20, extras: FOUNDING_USED });
    const { ai, calls } = scriptedAi(Array.from({ length: 10 }, () => fullLength()));

    for (let i = 0; i < 10; i += 1) {
      expect(
        (await runBodyScanForUser(member, USER, scan(crypto.randomUUID()), deps(ai))).success,
      ).toBe(true);
    }
    const eleventh = await runBodyScanForUser(member, USER, scan(crypto.randomUUID()), deps(ai));

    expect(eleventh).toEqual({ success: false, error: "BODY_SCAN_RATE_LIMITED" });
    expect(calls).toHaveLength(10);
    expect(rate.policies.every((p) => p.limit === 10 && p.windowSeconds === 3600)).toBe(true);
  });

  test("the same clientRequestId replays with no AI call", async () => {
    const { deps, store, rate } = setup({ purchased: 5, extras: FOUNDING_USED });
    const { ai, calls } = scriptedAi([fullLength("Apple")]);

    const first = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));
    const replay = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));

    expect(replay).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(store.balance(USER)).toEqual({ daily: 0, purchased: 4 });
    expect(rate.releases).toEqual([[RATE_KEY, RESET_AT]]);
  });

  test("a replay of a scan delivered but never stored passes DELIVERED_NOT_SAVED through, keeps its hourly slot, and is not reported as a failure", async () => {
    const { deps, store, rate } = setup({ purchased: 5, extras: FOUNDING_USED });
    const { ai, calls } = scriptedAi([fullLength("Apple")]);
    store.failComplete = true;
    const first = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));
    expect(first.success).toBe(true);
    expect(store.rows[0].error_code).toBe("persist_failed_delivered");
    store.failComplete = false;
    const before = { releases: [...rate.releases], balance: store.balance(USER) };

    const err = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai)).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(GenerationDeliveredUnsavedError);
    expect(calls).toHaveLength(1);
    expect(rate.releases).toEqual(before.releases);
    expect(rate.used(RATE_KEY)).toBe(2);
    expect(store.balance(USER)).toEqual(before.balance);
    expect(loggedText()).not.toContain("did not finish");
  });

  test("a replay of a refunded founding scan gives back only its own claim, once", async () => {
    const { deps, founding } = setup({ purchased: 5 });
    const { ai, calls } = scriptedAi([{ ok: false, status: 503 }]);

    await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));
    const replay = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));

    expect(replay).toEqual({ success: false, error: "BODY_SCAN_FAILED" });
    expect(calls).toHaveLength(1);
    // Each request claimed it once and handed it back once: it stays unused.
    expect(founding.state).toMatchObject({
      at: null,
      wins: 2,
      releases: 2,
      strayReleases: 0,
      doubleReleases: 0,
    });
  });

  test("the photo never appears in the job input, the result or a log line", async () => {
    const { deps, store } = setup({ purchased: 5 });
    const { ai } = scriptedAi([
      fullLength(),
      fullLength("Pear", false),
      { ok: false, status: 502 },
      { ok: true, args: { silhouette: "Blob", bodyFullLength: true } },
    ]);

    for (let i = 0; i < 4; i += 1) {
      await runBodyScanForUser(member, USER, scan(crypto.randomUUID()), deps(ai));
    }

    expect(store.rows[0].input).toEqual({
      photos: ["body"],
      digest: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    const stored = JSON.stringify(store.rows);
    expect(stored).not.toContain(BODY);
    expect(stored).not.toContain("base64");
    const logs = loggedText();
    expect(logs).not.toContain(BODY);
    expect(logs).not.toContain("base64");
  });

  test("a founding scan whose job was failed past its deadline gives the founding scan back", async () => {
    const { deps, store, founding } = setup();
    const { ai } = scriptedAi([fullLength()], () => {
      // The reaper failed the job while the provider was still answering.
      store.rows[0].status = "failed";
      store.rows[0].error_code = "deadline_exceeded";
    });

    const out = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));

    expect(out).toEqual({ success: false, error: "BODY_SCAN_FAILED" });
    expect(founding.state).toMatchObject({ at: null, wins: 1, releases: 1, doubleReleases: 0 });
  });

  test("a transient job re-read never leaves a delivered founding scan free (M-5)", async () => {
    const { deps, store, founding } = setup();
    const { ai } = scriptedAi([fullLength("Pear")], () => {
      store.get = async () => {
        throw new Error("connection reset");
      };
    });

    const out = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));

    expect(out).toMatchObject({ success: true, silhouette: "Pear" });
    expect(founding.state.at).not.toBeNull();
    expect(founding.state.releases).toBe(0);
  });

  test("out of credits answers INSUFFICIENT_CREDITS with no AI call", async () => {
    const { deps, store, rate } = setup({ purchased: 0, extras: FOUNDING_USED });
    const { ai, calls } = scriptedAi([fullLength()]);

    const out = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));

    expect(out).toEqual({ success: false, error: INSUFFICIENT_CREDITS });
    expect(calls).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
    expect(rate.releases).toEqual([[RATE_KEY, RESET_AT]]);
  });

  test("an unconfigured AI provider answers CONFIG_MISSING_API_KEY before anything else", async () => {
    const { deps, profile, rate } = setup();
    const { ai } = scriptedAi([]);

    const out = await runBodyScanForUser(
      member,
      USER,
      scan(REQ_A),
      deps(ai, { isAiConfigured: () => false }),
    );

    expect(out).toEqual({ success: false, error: "CONFIG_MISSING_API_KEY" });
    expect(profile.reads).toBe(0);
    expect(rate.used(RATE_KEY)).toBe(0);
  });

  test("with generation jobs missing: the founding scan runs free, the next under withAiCredit", async () => {
    const { deps, store, founding, legacy } = setup();
    store.missing = true;
    const { ai } = scriptedAi([fullLength("Pear"), fullLength("Pear", false)]);

    const first = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));
    expect(first).toEqual({ success: true, silhouette: "Pear" });
    expect(founding.state.at).not.toBeNull();
    expect(legacy.charges).toBe(0);

    const paid = await runBodyScanForUser(member, USER, scan(REQ_B), deps(ai));
    expect(paid).toEqual({ success: false, error: "BODY_SCAN_NOT_FULL_LENGTH" });
    expect(legacy).toEqual({ charges: 1, refunds: 1 });
    expect(founding.state).toMatchObject({ wins: 1, releases: 0, strayReleases: 0 });
  });

  test("with generation jobs missing, a refunded founding scan gives the claim back", async () => {
    const { deps, store, founding, legacy } = setup();
    store.missing = true;
    const { ai } = scriptedAi([fullLength("Pear", false)]);

    const out = await runBodyScanForUser(member, USER, scan(REQ_A), deps(ai));

    expect(out).toEqual({ success: false, error: "BODY_SCAN_NOT_FULL_LENGTH" });
    expect(founding.state).toMatchObject({ at: null, wins: 1, releases: 1 });
    expect(legacy.charges).toBe(0);
  });
});

describe("bodyScanPricing", () => {
  test("free only while her founding scan is unused and the read succeeded", () => {
    expect(bodyScanPricing(FOUNDING_UNUSED)).toEqual({ available: true, free: true, cost: 0 });
    expect(bodyScanPricing(FOUNDING_USED)).toEqual({ available: true, free: false, cost: 1 });
    for (const reason of ["missing", "missing_row", "error"] as const) {
      expect(bodyScanPricing(unavailable(reason))).toEqual({
        available: false,
        free: false,
        cost: 1,
      });
    }
  });
});

describe("BodyScanInput", () => {
  test("a body photo and an optional request id", () => {
    expect(BodyScanInput.parse(scan(REQ_A))).toEqual(scan(REQ_A));
    expect(BodyScanInput.safeParse({ bodyImageBase64: "" }).success).toBe(false);
    const huge = BodyScanInput.safeParse({ bodyImageBase64: "A".repeat(15_000_001) });
    expect(huge.error?.issues[0]?.message).toBe("That photo is too large. Try another one.");
  });
});

type Recorded = { method: string; url: URL; body: unknown };
type Reply = { status: number; body: unknown };

/** The REAL supabase-js client (2.110.0) with only `fetch` stubbed. */
function stubAdmin(answer: Reply | ((req: Recorded) => Reply)) {
  const requests: Recorded[] = [];
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const raw = await request.text();
    const recorded = {
      method: request.method,
      url: new URL(request.url),
      body: raw ? JSON.parse(raw) : null,
    };
    requests.push(recorded);
    const reply = typeof answer === "function" ? answer(recorded) : answer;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient<Database>("http://stub.supabase.test", "service-role-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub as typeof fetch },
  });
  return { admin: async () => client, requests };
}

const CLAIMED = "2026-10-07T12:00:00.000Z";
/** The claim asks for its row back (`select`); the release does not. */
const claimThenRelease = (req: Recorded): Reply =>
  req.url.searchParams.has("select")
    ? { status: 200, body: [{ id: USER }] }
    : { status: 204, body: null };

describe("foundingBodyScanSlot", () => {
  test("claim is one conditional update: only where her founding scan is unused", async () => {
    const { admin, requests } = stubAdmin({ status: 200, body: [{ id: USER }] });

    expect(await foundingBodyScanSlot(USER, admin, () => NOON).claim()).toBe(true);

    const [req] = requests;
    expect(req.method).toBe("PATCH");
    expect(req.url.pathname).toBe("/rest/v1/profiles");
    expect(req.url.searchParams.get("id")).toBe(`eq.${USER}`);
    expect(req.url.searchParams.get("founding_body_read_at")).toBe("is.null");
    expect(req.url.searchParams.get("select")).toBe("id");
    expect(req.body).toEqual({ founding_body_read_at: CLAIMED });
  });

  test("claim answers false when the update matched nothing: it is already spent or held", async () => {
    const { admin } = stubAdmin({ status: 200, body: [] });
    expect(await foundingBodyScanSlot(USER, admin, () => NOON).claim()).toBe(false);
  });

  test("release hands back exactly this claim, once, and only after it was won", async () => {
    const { admin, requests } = stubAdmin(claimThenRelease);
    const slot = foundingBodyScanSlot(USER, admin, () => NOON);

    await slot.release();
    expect(requests).toHaveLength(0);

    expect(await slot.claim()).toBe(true);
    await slot.release();
    await slot.release();

    expect(requests).toHaveLength(2);
    const release = requests[1];
    expect(release.method).toBe("PATCH");
    expect(release.url.searchParams.get("id")).toBe(`eq.${USER}`);
    // Only the stamp this request wrote: never a later claim by another request.
    expect(release.url.searchParams.get("founding_body_read_at")).toBe(`eq.${CLAIMED}`);
    expect(release.body).toEqual({ founding_body_read_at: null });
  });

  test("a request that lost the claim never gives it back", async () => {
    const { admin, requests } = stubAdmin({ status: 200, body: [] });
    const slot = foundingBodyScanSlot(USER, admin, () => NOON);

    expect(await slot.claim()).toBe(false);
    await slot.release();

    expect(requests).toHaveLength(1);
  });

  test("a failed claim throws without the database's text, so nothing runs free on a guess", async () => {
    const { admin } = stubAdmin({
      status: 500,
      body: { code: "XX000", details: null, hint: null, message: "secret internals" },
    });
    const claim = await foundingBodyScanSlot(USER, admin, () => NOON)
      .claim()
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(claim).toBeInstanceOf(Error);
    expect((claim as Error).message).not.toContain("secret internals");
  });
});

describe("markFoundingBodyReadUsed", () => {
  test("writes the marker with the service role, only where it is still unset", async () => {
    const { admin, requests } = stubAdmin({ status: 200, body: [{ id: USER }] });

    await markFoundingBodyReadUsed(USER, admin, () => NOON);

    const [req] = requests;
    expect(req.method).toBe("PATCH");
    expect(req.url.pathname).toBe("/rest/v1/profiles");
    expect(req.url.searchParams.get("id")).toBe(`eq.${USER}`);
    expect(req.url.searchParams.get("founding_body_read_at")).toBe("is.null");
    expect(req.body).toEqual({ founding_body_read_at: "2026-10-07T12:00:00.000Z" });
  });

  test("never throws: a failed write is logged and she keeps her read", async () => {
    const { admin } = stubAdmin({
      status: 500,
      body: { code: "XX000", details: null, hint: null, message: "x" },
    });
    await expect(markFoundingBodyReadUsed(USER, admin, () => NOON)).resolves.toBeUndefined();
  });
});
