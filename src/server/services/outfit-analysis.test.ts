import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { analyzeOutfitForUser, type OutfitAnalysisDeps } from "./outfit-analysis";
import { createAvailabilityCache, type GenerationJobDeps } from "@/lib/generation-jobs.server";
import { RateLimitExceededError, type consumeRateLimit } from "@/lib/rate-limit.server";
import type { aiChatCompletion } from "@/lib/ai.server";
import type { withAiCredit } from "@/lib/credits.server";
import { MemoryGenerationJobStore } from "../../../tests/helpers/memory-generation-job-store";

const USER = "user-1";
const REQUEST_ID = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
const OTHER_REQUEST_ID = "7f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
const BASE = "https://project.supabase.test";
const IMAGE = `${BASE}/storage/v1/object/public/outfits/user-1/photo.jpg`;
const INPUT = { imageUrl: IMAGE, bodyType: "Hourglass", colorSeason: "Bright Winter" };
const ANALYSIS = {
  color_match: "Great match",
  silhouette: "Flattering",
  overall_score: 87.6,
  verdict: "Looks great, try a belt.",
};

let previousUrl: string | undefined;
beforeAll(() => {
  previousUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = BASE;
});
afterAll(() => {
  if (previousUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previousUrl;
});

type InsertedRow = Record<string, unknown>;

function setup(opts: { insertError?: boolean; aiFails?: boolean; legacy?: boolean } = {}) {
  const store = new MemoryGenerationJobStore();
  store.seed(USER, 3);
  const inserted: InsertedRow[] = [];
  const counter = { ai: 0, legacyCharges: 0 };
  const admin = {
    from: (table: string) => {
      if (table !== "outfits") throw new Error(`unexpected table ${table}`);
      return {
        insert: (row: InsertedRow) => ({
          select: () => ({
            single: async () => {
              if (opts.insertError) return { data: null, error: { message: "boom" } };
              inserted.push(row);
              return { data: { id: `outfit-${inserted.length}` }, error: null };
            },
          }),
        }),
      };
    },
  };
  const ai = (async () => {
    counter.ai += 1;
    return opts.aiFails ? { ok: false } : { ok: true, args: ANALYSIS };
  }) as unknown as typeof aiChatCompletion;
  const withCredit = (async (_s: unknown, _u: string, produce: () => Promise<unknown>) => {
    counter.legacyCharges += 1;
    return produce();
  }) as unknown as typeof withAiCredit;
  const jobs: GenerationJobDeps = opts.legacy
    ? { availability: { isMissing: () => true, markMissing: () => {} } }
    : { store, availability: createAvailabilityCache(60_000) };
  const rateLimit = (async () => ({ allowed: true })) as unknown as typeof consumeRateLimit;
  const deps: OutfitAnalysisDeps = {
    ai,
    withCredit,
    jobs,
    dailyAllowance: async () => 3,
    admin: (async () => admin) as never,
    consumeRateLimit: rateLimit,
  };
  return { store, inserted, counter, deps };
}

const client = {} as never;

describe("analyzeOutfitForUser as a generation job", () => {
  test("same clientRequestId twice: one AI call, one charge, one outfits row, the same outfitId", async () => {
    const { store, inserted, counter, deps } = setup();
    const input = { ...INPUT, clientRequestId: REQUEST_ID, saveToHistory: true };
    const first = await analyzeOutfitForUser(client, USER, input, {}, deps);
    const second = await analyzeOutfitForUser(client, USER, input, {}, deps);
    expect(counter.ai).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });
    expect(first.outfitId).toBe("outfit-1");
    expect(second.outfitId).toBe("outfit-1");
    expect(counter.legacyCharges).toBe(0);
  });

  test("replay answers the stored analysis and outfitId", async () => {
    const { store, deps } = setup();
    const input = { ...INPUT, clientRequestId: REQUEST_ID, saveToHistory: true };
    await analyzeOutfitForUser(client, USER, input, {}, deps);
    const replay = await analyzeOutfitForUser(client, USER, input, {}, deps);
    expect(replay).toMatchObject({
      color_match: "Great match",
      silhouette: "Flattering",
      verdict: "Looks great, try a belt.",
      outfitId: "outfit-1",
      jobId: store.rows[0].id,
    });
    expect(replay.overall_score).toBe(88);
  });

  test("saveToHistory absent: no server write, outfitId null", async () => {
    const { inserted, deps } = setup();
    const out = await analyzeOutfitForUser(
      client,
      USER,
      { ...INPUT, clientRequestId: REQUEST_ID },
      {},
      deps,
    );
    expect(inserted).toHaveLength(0);
    expect(out.outfitId).toBeNull();
  });

  test("an untrusted image URL is refused before any job or charge", async () => {
    const { store, counter, deps } = setup();
    await expect(
      analyzeOutfitForUser(
        client,
        USER,
        { ...INPUT, imageUrl: "https://evil.test/a.jpg", clientRequestId: REQUEST_ID },
        {},
        deps,
      ),
    ).rejects.toThrow();
    expect(store.calls.start).toBe(0);
    expect(store.rows).toHaveLength(0);
    expect(counter.ai).toBe(0);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
  });

  test("AI failure refunds once and writes nothing", async () => {
    const { store, inserted, deps } = setup({ aiFails: true });
    await expect(
      analyzeOutfitForUser(
        client,
        USER,
        { ...INPUT, clientRequestId: REQUEST_ID, saveToHistory: true },
        {},
        deps,
      ),
    ).rejects.toThrow("AI analysis failed.");
    expect(inserted).toHaveLength(0);
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
  });

  test("outfits insert failure still answers the analysis with outfitId null and keeps the charge", async () => {
    const { store, deps } = setup({ insertError: true });
    const out = await analyzeOutfitForUser(
      client,
      USER,
      { ...INPUT, clientRequestId: REQUEST_ID, saveToHistory: true },
      {},
      deps,
    );
    expect(out.verdict).toBe("Looks great, try a belt.");
    expect(out.outfitId).toBeNull();
    expect(store.calls.refunds).toBe(0);
    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });
  });

  test("match_score is normalized (87.6 becomes 88, 140 becomes 100, 82 string becomes 82)", async () => {
    const cases: Array<[unknown, number | null]> = [
      [87.6, 88],
      [140, 100],
      ["82", 82],
    ];
    for (const [score, expected] of cases) {
      const { inserted, deps } = setup();
      const ai = (async () => ({
        ok: true,
        args: { ...ANALYSIS, overall_score: score },
      })) as unknown as typeof aiChatCompletion;
      await analyzeOutfitForUser(
        client,
        USER,
        { ...INPUT, clientRequestId: REQUEST_ID, saveToHistory: true },
        {},
        { ...deps, ai },
      );
      expect(inserted[0].match_score).toBe(expected);
      expect(inserted[0].user_id).toBe(USER);
      expect(inserted[0].image_url).toBe(IMAGE);
    }
  });

  test("a malformed read (string score, extra keys, 10k verdict) replays to the same answer", async () => {
    const { store, inserted, deps } = setup();
    const ai = (async () => ({
      ok: true,
      args: { ...ANALYSIS, overall_score: "82", verdict: "v".repeat(10_000), junk: "x" },
    })) as unknown as typeof aiChatCompletion;
    const input = { ...INPUT, clientRequestId: REQUEST_ID, saveToHistory: true };
    const first = await analyzeOutfitForUser(client, USER, input, {}, { ...deps, ai });
    const replay = await analyzeOutfitForUser(client, USER, input, {}, { ...deps, ai });
    expect(first.overall_score).toBe(82);
    expect(first.verdict.length).toBeLessThanOrEqual(2000);
    expect(Object.keys(first).sort()).toEqual([
      "color_match",
      "jobId",
      "outfitId",
      "overall_score",
      "silhouette",
      "verdict",
    ]);
    expect(replay).toEqual(first);
    expect(Object.keys(store.rows[0].result as object).sort()).toEqual([
      "color_match",
      "outfitId",
      "overall_score",
      "silhouette",
      "verdict",
    ]);
    expect(Object.keys(inserted[0].analysis_result as object).sort()).toEqual([
      "color_match",
      "overall_score",
      "silhouette",
      "verdict",
    ]);
    expect(store.calls.refunds).toBe(0);
  });

  test("an unusable score (x) becomes null: delivered, charged, and replays identically", async () => {
    const { store, inserted, deps } = setup();
    const ai = (async () => ({
      ok: true,
      args: { ...ANALYSIS, overall_score: "x" },
    })) as unknown as typeof aiChatCompletion;
    const input = { ...INPUT, clientRequestId: REQUEST_ID, saveToHistory: true };
    const first = await analyzeOutfitForUser(client, USER, input, {}, { ...deps, ai });
    const replay = await analyzeOutfitForUser(client, USER, input, {}, { ...deps, ai });
    expect(first.overall_score).toBeNull();
    expect(first.verdict).toBe("Looks great, try a belt.");
    expect(replay).toEqual(first);
    expect(inserted[0].match_score).toBeNull();
    expect(store.calls.refunds).toBe(0);
    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });
  });

  test("a missing field refunds once and writes nothing", async () => {
    const { store, inserted, deps } = setup();
    const ai = (async () => ({
      ok: true,
      args: { color_match: "ok", silhouette: "ok", overall_score: 80 },
    })) as unknown as typeof aiChatCompletion;
    await expect(
      analyzeOutfitForUser(
        client,
        USER,
        { ...INPUT, clientRequestId: REQUEST_ID, saveToHistory: true },
        {},
        { ...deps, ai },
      ),
    ).rejects.toThrow("AI analysis failed.");
    expect(inserted).toHaveLength(0);
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
  });

  test("a read that outlives its deadline writes no outfits row and the job is refunded", async () => {
    const { store, inserted, deps } = setup();
    const slowAi = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { ok: true, args: ANALYSIS };
    }) as unknown as typeof aiChatCompletion;
    const out = await analyzeOutfitForUser(
      client,
      USER,
      { ...INPUT, clientRequestId: REQUEST_ID, saveToHistory: true },
      {},
      {
        ...deps,
        ai: slowAi,
        deadlineSeconds: 0.03,
        jobs: { ...deps.jobs, persistReserveMs: 0 },
      },
    ).catch((err: unknown) => err);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(out).toBeInstanceOf(Error);
    expect(inserted).toHaveLength(0);
    expect(store.rows[0].status).toBe("failed");
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
  });

  test("stillRunning failing to read the job means no write", async () => {
    const { store, inserted, deps } = setup();
    const unreadable = new Proxy(store, {
      get(target, prop) {
        if (prop === "get") {
          return async () => {
            throw new Error("read failed");
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const out = await analyzeOutfitForUser(
      client,
      USER,
      { ...INPUT, clientRequestId: REQUEST_ID, saveToHistory: true },
      {},
      { ...deps, jobs: { ...deps.jobs, store: unreadable } },
    );
    expect(inserted).toHaveLength(0);
    expect(out.outfitId).toBeNull();
    expect(out.verdict).toBe("Looks great, try a belt.");
  });

  test("migration missing: legacy withAiCredit path, outfitId null, no server write", async () => {
    const { inserted, counter, deps } = setup({ legacy: true });
    const out = await analyzeOutfitForUser(
      client,
      USER,
      { ...INPUT, clientRequestId: REQUEST_ID, saveToHistory: true },
      {},
      deps,
    );
    expect(counter.legacyCharges).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(out.outfitId).toBeNull();
    expect(out.jobId).toBeUndefined();
  });

  test("report mode answers running while another read is in flight", async () => {
    const { store, deps } = setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowAi = (async () => {
      await gate;
      return { ok: true, args: ANALYSIS };
    }) as unknown as typeof aiChatCompletion;
    const first = analyzeOutfitForUser(
      client,
      USER,
      { ...INPUT, clientRequestId: REQUEST_ID },
      {},
      { ...deps, ai: slowAi },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await analyzeOutfitForUser(
      client,
      USER,
      { ...INPUT, clientRequestId: OTHER_REQUEST_ID },
      { inFlight: "report" },
      deps,
    );
    expect(second).toEqual({ status: "running", jobId: store.rows[0].id });
    release();
    await first;
  });

  test("the rate limit still runs first and its refusal charges nothing", async () => {
    const { store, deps } = setup();
    const limited = (async () => {
      throw new RateLimitExceededError(60);
    }) as unknown as typeof consumeRateLimit;
    await expect(
      analyzeOutfitForUser(
        client,
        USER,
        { ...INPUT, clientRequestId: REQUEST_ID },
        {},
        { ...deps, consumeRateLimit: limited },
      ),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
    expect(store.calls.start).toBe(0);
  });
});
