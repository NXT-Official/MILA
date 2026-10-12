import { describe, expect, mock, spyOn, test, type Mock } from "bun:test";
import { createHash } from "node:crypto";
import type { AiResult, aiChatCompletion } from "@/lib/ai.server";
import {
  GenerationDeliveredUnsavedError,
  GenerationInFlightError,
  createAvailabilityCache,
  withGenerationJob,
  type GenerationJobDeps,
} from "@/lib/generation-jobs.server";
import { INSUFFICIENT_CREDITS, InsufficientCreditsError } from "@/lib/credits";
import { RateLimitExceededError } from "@/lib/rate-limit.server";
import { HAIR_COLORS, SKIN_DEPTHS } from "@/constants/style-profile";
import { MemoryGenerationJobStore } from "../../../tests/helpers/memory-generation-job-store";
import {
  analyzePersonalColorForUser,
  claimFoundingColorRead,
  giveBackFoundingColorRead,
  type FoundingReadClaim,
  type PersonalColorAnalysisDeps,
  type PersonalColorAnalysisInputData,
} from "./personal-color-analysis";

const USER = "user-1";
const IMAGE = { imageBase64: "aGVsbG8=" };
const S = 1_000;
const REQUEST_ID = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
/** `check_rate_limit` answers its window's end as Postgres text, microseconds
 * included; the release must send exactly this text back. */
const RESET_AT = "2026-10-07 11:00:00.123456+00";
const RATE_KEY = `ai:analyzePersonalColor:${USER}`;
const USED_FOUNDING_READ = "2026-10-06T12:00:00Z";

const CALIBRATION = {
  ambientLighting: "clear_daylight",
  biologicalUndertone: "warm_peach",
  computedContrast: "medium",
};

// Daylight + a non-fallback season, so the glare intercept never rewrites it.
const SLIM = {
  season: "AUTUMN_DEEP",
  contrastScore: 70,
  undertone: "Warm",
  faceShape: "Oval Frame",
  bodyType: "Hourglass",
  stylistNote:
    "Your warm depth carries rich, spiced colour beautifully. Deep brick and espresso sit right with your features.",
  detectedLighting: "Ideal Daylight",
  calculatedUndertone: "True Warm",
  confidenceScore: 82,
};

// What Postgres answers a member's profiles upsert with: the INSERT policy's
// WITH CHECK runs on every proposed upsert row, and the payload has no username.
const RLS_REFUSAL = {
  code: "42501",
  message: 'new row violates row-level security policy for table "profiles"',
};

const ok = (args: unknown): AiResult => ({ ok: true, args });
const fail = (status: number): AiResult => ({ ok: false, status });

type HarnessOptions = {
  /** Set = the founding read was already used, so this read is charged. */
  foundingReadAt?: string | null;
  upsertError?: { code: string; message: string } | null;
  /** How long each successive AI call takes on the fake clock; "whole" runs
   * it to the timeout it was given (the worst case). */
  callDurationsMs?: Array<number | "whole">;
  /** generation_jobs: installed (the default) or not applied yet, when the
   * read runs its legacy withAiCredit path. */
  jobs?: "installed" | "missing";
  /** A job store shared between runs (a replay); a fresh one otherwise. */
  store?: MemoryGenerationJobStore;
  /** Her credit pool on the job path, and the allowance it resets to. */
  dailyCredits?: number;
  /** What the founding check's profiles read answers, when not her row. */
  profileRead?: { data: unknown; error: unknown };
  persistDossierOnServer?: boolean;
  releaseRateLimit?: ReleaseMock;
  withGenerationJob?: PersonalColorAnalysisDeps["withGenerationJob"];
  /** `profiles.founding_color_read_at`, shared between runs that race. */
  marker?: FoundingMarker;
  /** The founding claim's write fails. */
  claimError?: boolean;
  /** A counting hourly limit, shared between runs: a release gives a slot back. */
  hourly?: HourlyLimit;
  /** Every AI call waits for this before answering (to hold a read in flight). */
  gate?: Promise<void>;
  /** The legacy withAiCredit finds no credit left. */
  legacyOutOfCredits?: boolean;
};

type AiCall = { tool: string; timeoutMs: number | undefined; toolDef: unknown; system: string };
type ReleaseMock = Mock<(key: string, resetAt: string | Date) => Promise<boolean>>;
/** The marker column, as one value the fakes below read and write. */
type FoundingMarker = { at: string | null };
type HourlyLimit = { used: number; limit: number };

const newMarker = (at: string | null = null): FoundingMarker => ({ at });
const releaseMock = (): ReleaseMock => mock(async (_key: string, _resetAt: string | Date) => true);

function harness(replies: AiResult[], opts: HarnessOptions = {}) {
  const queue = [...replies];
  const durations = [...(opts.callDurationsMs ?? [])];
  let clock = 0;
  const calls: AiCall[] = [];
  const legacyCredits = { charged: 0, refunded: 0 };
  const upserts: unknown[] = [];
  const marker = opts.marker ?? newMarker(opts.foundingReadAt ?? null);
  const hourly = opts.hourly;

  const ownStore = !opts.store;
  const store = opts.store ?? new MemoryGenerationJobStore();
  const dailyCredits = opts.dailyCredits ?? 3;
  if (ownStore) store.seed(USER, dailyCredits);
  // A waiting request polls every few ms, so an attach resolves inside a test.
  const fastPolls = {
    pollMs: 5,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5))),
  };
  const jobDeps: GenerationJobDeps =
    opts.jobs === "missing"
      ? { store, availability: { isMissing: () => true, markMissing: () => {} } }
      : { store, availability: createAvailabilityCache(60_000), ...fastPolls };

  const member = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            opts.profileRead ?? {
              data: {
                skin_undertone: null,
                color_season: null,
                color_profile: null,
                founding_color_read_at: marker.at,
              },
              error: null,
            },
        }),
      }),
      upsert: async (row: unknown) => {
        upserts.push(row);
        return { error: opts.upsertError ?? null };
      },
    }),
  } as unknown as Parameters<typeof analyzePersonalColorForUser>[0];

  // The database's conditional update, as one synchronous check-and-set: only
  // one request can move the marker from NULL.
  let claims = 0;
  const claimFoundingRead = mock(async (_userId: string): Promise<FoundingReadClaim> => {
    if (opts.claimError) return { outcome: "error" };
    if (marker.at !== null) return { outcome: "taken" };
    claims += 1;
    marker.at = `claimed-${claims}`;
    return { outcome: "claimed", claimedAt: marker.at };
  });
  const giveBackFoundingRead = mock(async (_userId: string, claimedAt: string) => {
    if (marker.at === claimedAt) marker.at = null;
  });
  const markFoundingRead = mock(async (_userId: string) => {
    marker.at = "read-produced";
  });
  const consumeRateLimit = mock(async () => {
    if (hourly) {
      if (hourly.used >= hourly.limit) throw new RateLimitExceededError(60);
      hourly.used += 1;
    }
    return { allowed: true, remaining: 9, reset_at: RESET_AT, retry_after_seconds: 0 };
  });
  const releaseRateLimit =
    opts.releaseRateLimit ??
    mock(async (_key: string, _resetAt: string | Date) => {
      if (hourly) hourly.used = Math.max(0, hourly.used - 1);
      return true;
    });
  const withAiCredit = mock((async (_supabase, _userId, produce, creditOpts) => {
    if (opts.legacyOutOfCredits) throw new InsufficientCreditsError();
    legacyCredits.charged += 1;
    const result = await produce();
    if (creditOpts?.refundIf?.(result)) legacyCredits.refunded += 1;
    return result;
  }) as PersonalColorAnalysisDeps["withAiCredit"]);

  const deps: PersonalColorAnalysisDeps = {
    aiChatCompletion: mock(async (...args: Parameters<typeof aiChatCompletion>) => {
      const [messages, tool, , options] = args;
      calls.push({
        tool: tool.function.name,
        timeoutMs: options?.timeoutMs,
        toolDef: tool,
        system: String(messages[0]?.content ?? ""),
      });
      if (opts.gate) await opts.gate;
      const duration = durations.shift() ?? 20 * S;
      clock += duration === "whole" ? (options?.timeoutMs ?? Infinity) : duration;
      const next = queue.shift();
      if (!next) throw new Error("unexpected extra AI call");
      return next;
    }),
    isAiConfigured: () => true,
    consumeRateLimit,
    withAiCredit,
    markFoundingRead,
    now: () => clock,
    withGenerationJob:
      opts.withGenerationJob ?? ((spec, produce) => withGenerationJob(spec, produce, jobDeps)),
    dailyAllowance: async () => dailyCredits,
    releaseRateLimit,
    persistDossierOnServer: opts.persistDossierOnServer,
    claimFoundingRead,
    giveBackFoundingRead,
  };

  return {
    run: (input: Partial<PersonalColorAnalysisInputData> = {}) =>
      analyzePersonalColorForUser(member, USER, { ...IMAGE, ...input }, deps),
    elapsedMs: () => clock,
    calls,
    /** Charges and refunds on whichever path ran: the job store's, or the
     * legacy withAiCredit's. */
    get credits() {
      return {
        charged: legacyCredits.charged + store.rows.filter((r) => r.credit_state !== "none").length,
        refunded: legacyCredits.refunded + store.calls.refunds,
      };
    },
    upserts,
    store,
    marker,
    markFoundingRead,
    claimFoundingRead,
    giveBackFoundingRead,
    consumeRateLimit,
    releaseRateLimit,
    withAiCredit,
  };
}

/** Mobile's client gives up on the colour read at 180s
 * (TIMEOUTS.personalColor); a read answering later still spends the
 * founding read, so the service must answer before it. */
const MOBILE_CLIENT_TIMEOUT_MS = 180 * S;

describe("founding-read marker", () => {
  test("a successful founding read records the marker even when the member's dossier upsert is refused", async () => {
    // Live QA: the read succeeded, founding_color_read_at stayed null. The
    // marker was gated on the server-side upsert, which RLS refuses for
    // every member — so the free read could be repeated forever (MW-10).
    // The server write is off by default now (R-10); turned on here, it is
    // still refused, and the marker still lands.
    const h = harness([ok(CALIBRATION), ok(SLIM)], {
      upsertError: RLS_REFUSAL,
      persistDossierOnServer: true,
    });

    const result = await h.run();

    expect(result.success).toBe(true);
    expect(h.upserts).toHaveLength(1);
    expect(h.markFoundingRead).toHaveBeenCalledTimes(1);
    expect(h.markFoundingRead).toHaveBeenCalledWith(USER);
    expect(h.credits.charged).toBe(0);
  });

  test("a successful founding read whose dossier saves records the marker once", async () => {
    const h = harness([ok(CALIBRATION), ok(SLIM)]);

    expect((await h.run()).success).toBe(true);
    expect(h.markFoundingRead).toHaveBeenCalledTimes(1);
  });

  test("a re-read is charged one credit and never rewrites the marker", async () => {
    const h = harness([ok(CALIBRATION), ok(SLIM)], { foundingReadAt: "2026-10-06T12:00:00Z" });

    expect((await h.run()).success).toBe(true);
    expect(h.credits).toEqual({ charged: 1, refunded: 0 });
    expect(h.markFoundingRead).not.toHaveBeenCalled();
  });

  test("a failed founding read stays free and leaves the marker unset", async () => {
    const h = harness([ok(CALIBRATION), fail(502), fail(502)]);

    const result = await h.run();

    expect(result).toEqual({ success: false, error: "ANALYSIS_PARSING_FAILED" });
    expect(h.markFoundingRead).not.toHaveBeenCalled();
    expect(h.credits.charged).toBe(0);
  });
});

describe("tolerant parsing of the model's reply", () => {
  test("enum values in another case or spacing map to the canonical value", async () => {
    const h = harness([
      ok({
        ambientLighting: "Clear Daylight",
        biologicalUndertone: "WARM_PEACH",
        computedContrast: "low_medium",
      }),
      ok({
        ...SLIM,
        season: "Autumn Deep",
        undertone: "warm",
        faceShape: "Oval",
        bodyType: "inverted triangle",
      }),
    ]);

    const result = await h.run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.profile.subSeason).toContain("Autumn Deep");
    expect(result.profile.faceShape).toBe("Oval Frame");
    expect(result.profile.bodyType).toBe("Inverted Triangle");
    expect(result.telemetry.pass1Raw).toEqual({
      ambientLighting: "clear_daylight",
      biologicalUndertone: "warm_peach",
      computedContrast: "low-medium",
    });
    expect(h.calls).toHaveLength(2);
  });

  test("scores outside 1-100 are brought into range instead of failing the read", async () => {
    // The prompt itself tells the model to "strip 40 points" from contrast
    // and to scale it down by 30%, which can land at or below zero; a
    // fractional confidence (0.82) means 82%.
    const h = harness([
      ok(CALIBRATION),
      ok({ ...SLIM, contrastScore: -12, confidenceScore: 0.82 }),
    ]);

    const result = await h.run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.profile.confidenceScore).toBe(82);
    expect(h.calls).toHaveLength(2);
  });

  test("numeric strings are read as numbers", async () => {
    const h = harness([
      ok(CALIBRATION),
      ok({ ...SLIM, contrastScore: "64", confidenceScore: "77" }),
    ]);

    const result = await h.run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.profile.confidenceScore).toBe(77);
  });

  test("a value that maps to nothing is still refused", async () => {
    // "AUTUMN" alone could be any of four keys — guessing would be inventing.
    const h = harness([
      ok(CALIBRATION),
      ok({ ...SLIM, season: "AUTUMN" }),
      ok({ ...SLIM, season: "AUTUMN" }),
    ]);

    expect(await h.run()).toEqual({ success: false, error: "ANALYSIS_PARSING_FAILED" });
  });

  test("a one-word lighting read is not stretched into a specific light source", async () => {
    // "cool" light could be shade or overcast daylight as easily as a
    // fluorescent tube — only case and spacing variants are mapped there.
    const h = harness([
      ok({ ...CALIBRATION, ambientLighting: "cool" }),
      ok({ ...CALIBRATION, ambientLighting: "warm" }),
    ]);

    expect(await h.run()).toEqual({ success: false, error: "ANALYSIS_PARSING_FAILED" });
    expect(h.calls).toHaveLength(2);
  });
});

describe("one bounded retry for an unusable reply", () => {
  test("an unparseable reply (502) is retried once and the read succeeds", async () => {
    const h = harness([ok(CALIBRATION), fail(502), ok(SLIM)]);

    const result = await h.run();

    expect(result.success).toBe(true);
    expect(h.calls.map((c) => c.tool)).toEqual([
      "report_calibration",
      "report_studio_color_profile",
      "report_studio_color_profile",
    ]);
  });

  test("a reply outside the schema is retried once and the read succeeds", async () => {
    const h = harness([ok(CALIBRATION), ok({ ...SLIM, season: "SPRING_SOMETHING" }), ok(SLIM)]);

    expect((await h.run()).success).toBe(true);
    expect(h.calls).toHaveLength(3);
  });

  test("a pass-1 failure can use the retry too", async () => {
    const h = harness([fail(502), ok(CALIBRATION), ok(SLIM)]);

    expect((await h.run()).success).toBe(true);
    expect(h.calls.map((c) => c.tool)).toEqual([
      "report_calibration",
      "report_calibration",
      "report_studio_color_profile",
    ]);
  });

  test("never more than one retry per read", async () => {
    const h = harness([fail(502), ok(CALIBRATION), fail(502), ok(SLIM)]);

    expect(await h.run()).toEqual({ success: false, error: "ANALYSIS_PARSING_FAILED" });
    expect(h.calls).toHaveLength(3);
  });

  test("timeouts and rate limits are final — no retry", async () => {
    const timedOut = harness([ok(CALIBRATION), fail(504), ok(SLIM)]);
    expect(await timedOut.run()).toEqual({ success: false, error: "ANALYSIS_GATEWAY_FAILURE" });
    expect(timedOut.calls).toHaveLength(2);

    const limited = harness([ok(CALIBRATION), fail(429), ok(SLIM)]);
    expect(await limited.run()).toEqual({ success: false, error: "ANALYSIS_RATE_LIMITED" });
    expect(limited.calls).toHaveLength(2);
  });

  test("each call is bounded, and the retry gets only what is left of the read's budget", async () => {
    // Live QA shape: pass 2 unusable at ~97s. 100s used of the 165s budget.
    const h = harness([ok(CALIBRATION), fail(502), ok(SLIM)], {
      callDurationsMs: [20 * S, 80 * S, 20 * S],
    });

    expect((await h.run()).success).toBe(true);
    expect(h.calls.map((c) => c.timeoutMs)).toEqual([110 * S, 110 * S, 65 * S]);
  });

  test("no retry once the budget can't fit a plausible attempt", async () => {
    // 140s used: 25s left is below the 30s a vision call needs.
    const h = harness([ok(CALIBRATION), fail(502), ok(SLIM)], {
      callDurationsMs: [60 * S, 80 * S],
    });

    expect(await h.run()).toEqual({ success: false, error: "ANALYSIS_PARSING_FAILED" });
    expect(h.calls).toHaveLength(2);
  });

  test("a slow pass 1 shortens pass 2 instead of running past the budget", async () => {
    const h = harness([ok(CALIBRATION), ok(SLIM)], { callDurationsMs: [100 * S, 20 * S] });

    expect((await h.run()).success).toBe(true);
    expect(h.calls.map((c) => c.timeoutMs)).toEqual([110 * S, 65 * S]);
  });

  test("a pass-1 retry keeps a whole attempt's room for pass 2", async () => {
    // 100s used, 65s left: the retry gets 35s so pass 2 still has its 30s.
    const h = harness([fail(502), ok(CALIBRATION), ok(SLIM)], {
      callDurationsMs: [100 * S, "whole", "whole"],
    });

    expect((await h.run()).success).toBe(true);
    expect(h.calls.map((c) => c.timeoutMs)).toEqual([110 * S, 35 * S, 30 * S]);
  });

  test("every read answers before mobile's client gives up, however the calls go", async () => {
    // Worst cases: each call runs to its whole timeout, and a failure can
    // land at any point of the first attempt of either pass.
    const late: string[] = [];
    for (let xMs = 5 * S; xMs <= 110 * S; xMs += 5 * S) {
      const pass1Retry = [fail(502), ok(CALIBRATION), ok(SLIM)];
      const pass2Retry = [ok(CALIBRATION), fail(502), ok(SLIM)];
      const scenarios: Array<[string, AiResult[], Array<number | "whole">]> = [
        ["pass 1 unusable at x", pass1Retry, [xMs, "whole", "whole"]],
        ["pass 2 unusable x into it", pass2Retry, [20 * S, xMs, "whole"]],
        ["pass 2 unusable after a pass 1 of x", pass2Retry, [xMs, "whole", "whole"]],
        ["no retry, pass 1 of x", [ok(CALIBRATION), ok(SLIM)], [xMs, "whole"]],
      ];
      for (const [name, replies, durations] of scenarios) {
        const h = harness(replies, { callDurationsMs: durations });
        await h.run();
        // 10s kept back for the profile reads and writes around the calls.
        if (h.elapsedMs() > MOBILE_CLIENT_TIMEOUT_MS - 10 * S) {
          late.push(`${name}=${xMs / S}s answered at ${h.elapsedMs() / S}s`);
        }
      }
    }
    expect(late).toEqual([]);
  });

  test("a charged re-read is charged once whether or not it needed the retry, and refunded if it still fails", async () => {
    const recovered = harness([ok(CALIBRATION), fail(502), ok(SLIM)], {
      foundingReadAt: "2026-10-06T12:00:00Z",
    });
    expect((await recovered.run()).success).toBe(true);
    expect(recovered.credits).toEqual({ charged: 1, refunded: 0 });

    const failed = harness([ok(CALIBRATION), fail(502), fail(502)], {
      foundingReadAt: "2026-10-06T12:00:00Z",
    });
    expect((await failed.run()).success).toBe(false);
    expect(failed.credits).toEqual({ charged: 1, refunded: 1 });
  });
});

const pass2 = (h: ReturnType<typeof harness>) => {
  const call = h.calls.find((c) => c.tool === "report_studio_color_profile");
  if (!call) throw new Error("no Pass-2 call was made");
  return call;
};

describe("colour read: hair colour and skin depth", () => {
  test("Pass 2 returns hairColor and skinDepth and the read still makes exactly two AI calls", async () => {
    const h = harness([
      ok(CALIBRATION),
      ok({ ...SLIM, hairColor: "Dark brown", skinDepth: "Medium" }),
    ]);

    const result = await h.run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.profile.hairColor).toBe("Dark brown");
    expect(result.profile.skinDepth).toBe("Medium");
    expect(h.calls.map((c) => c.tool)).toEqual([
      "report_calibration",
      "report_studio_color_profile",
    ]);

    // The same Pass-2 tool asks for both, from the fixed lists.
    const tool = pass2(h).toolDef as {
      function: {
        parameters: {
          properties: Record<string, { enum?: string[] }>;
          required: string[];
        };
      };
    };
    const { properties, required } = tool.function.parameters;
    // Null is "her hair cannot be seen" (fix round 1, M-4).
    expect(properties.hairColor.enum).toEqual([...HAIR_COLORS, null]);
    expect(properties.skinDepth.enum).toEqual([...SKIN_DEPTHS]);
    expect(required).toContain("hairColor");
    expect(required).toContain("skinDepth");
    expect(pass2(h).system).toContain("`hairColor`: her hair as it looks today, dyed or natural");
    expect(pass2(h).system).toContain(
      "`skinDepth`: how light or deep her skin is after the light correction, one of Fair, Light, Medium, Tan, Deep.",
    );
  });

  test("case and spacing variants map to the stored value", async () => {
    const h = harness([
      ok(CALIBRATION),
      ok({ ...SLIM, hairColor: "golden_blonde", skinDepth: "DEEP" }),
    ]);

    const result = await h.run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.profile.hairColor).toBe("Golden blonde");
    expect(result.profile.skinDepth).toBe("Deep");
  });

  test("a Pass-2 reply without hairColor or skinDepth still succeeds without them", async () => {
    const h = harness([ok(CALIBRATION), ok(SLIM)]);

    const result = await h.run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect("hairColor" in result.profile).toBe(false);
    expect("skinDepth" in result.profile).toBe(false);
    expect(h.calls).toHaveLength(2);
  });

  test("an unknown hairColor value is dropped", async () => {
    // Never a guess, and never worth a retry: the season read is still good.
    const h = harness([
      ok(CALIBRATION),
      ok({ ...SLIM, hairColor: "Teal ombre", skinDepth: "Very light" }),
    ]);

    const result = await h.run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.profile.hairColor).toBeUndefined();
    expect(result.profile.skinDepth).toBeUndefined();
    expect(result.profile.season).toBe("Autumn");
    expect(h.calls).toHaveLength(2);
  });
});

describe("colour read as a generation job", () => {
  test("a re-read runs as a color_read job charged once; the same clientRequestId replays with no AI call", async () => {
    const store = new MemoryGenerationJobStore();
    store.seed(USER, 3);
    const first = harness([ok(CALIBRATION), ok(SLIM)], {
      foundingReadAt: USED_FOUNDING_READ,
      store,
    });
    const again = harness([], { foundingReadAt: USED_FOUNDING_READ, store });

    const read = await first.run({ clientRequestId: REQUEST_ID });
    const replay = await again.run({ clientRequestId: REQUEST_ID });

    expect(read.success).toBe(true);
    expect(store.rows).toHaveLength(1);
    const [job] = store.rows;
    expect(job.kind).toBe("color_read");
    expect(job.client_request_id).toBe(REQUEST_ID);
    expect(job.status).toBe("succeeded");
    expect(job.credit_state).toBe("charged");
    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });
    expect(first.calls).toHaveLength(2);
    expect(again.calls).toHaveLength(0);
    expect(read.success && read.jobId).toBe(job.id);
    expect(replay).toEqual(read);
    expect(first.withAiCredit).not.toHaveBeenCalled();
    // A delivered read keeps its slot, and a replay never hands one back.
    expect(first.releaseRateLimit).not.toHaveBeenCalled();
    expect(again.releaseRateLimit).not.toHaveBeenCalled();
  });

  test("a replay of a read delivered but never stored passes DELIVERED_NOT_SAVED through, keeps its hourly slot, and is not reported as a failure", async () => {
    const store = new MemoryGenerationJobStore();
    store.seed(USER, 3);
    const first = harness([ok(CALIBRATION), ok(SLIM)], {
      foundingReadAt: USED_FOUNDING_READ,
      store,
    });
    store.failComplete = true;
    const read = await first.run({ clientRequestId: REQUEST_ID });
    expect(read.success).toBe(true);
    expect(store.rows[0].error_code).toBe("persist_failed_delivered");
    store.failComplete = false;
    const balance = store.balance(USER);
    const again = harness([], { foundingReadAt: USED_FOUNDING_READ, store });
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = await again.run({ clientRequestId: REQUEST_ID }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(GenerationDeliveredUnsavedError);
      expect(again.calls).toHaveLength(0);
      expect(again.releaseRateLimit).not.toHaveBeenCalled();
      expect(store.balance(USER)).toEqual(balance);
      expect(store.calls.refunds).toBe(0);
      expect(
        error.mock.calls.some((args) => String(args[0]).includes("Unhandled gateway exception")),
      ).toBe(false);
    } finally {
      error.mockRestore();
    }
  });

  test("the founding read is a free job and sets founding_color_read_at only on success", async () => {
    const read = harness([ok(CALIBRATION), ok(SLIM)]);
    expect((await read.run({ clientRequestId: REQUEST_ID })).success).toBe(true);
    expect(read.store.rows).toHaveLength(1);
    expect(read.store.rows[0].kind).toBe("color_read");
    expect(read.store.rows[0].credit_state).toBe("none");
    expect(read.store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
    expect(read.claimFoundingRead).toHaveBeenCalledTimes(1);
    expect(read.markFoundingRead).toHaveBeenCalledTimes(1);
    expect(read.giveBackFoundingRead).not.toHaveBeenCalled();
    expect(read.marker.at).not.toBeNull();

    const failed = harness([ok(CALIBRATION), fail(502), fail(502)]);
    expect(await failed.run({ clientRequestId: REQUEST_ID })).toEqual({
      success: false,
      error: "ANALYSIS_PARSING_FAILED",
    });
    expect(failed.store.rows[0].status).toBe("failed");
    expect(failed.store.rows[0].error_code).toBe("ANALYSIS_PARSING_FAILED");
    expect(failed.store.rows[0].credit_state).toBe("none");
    expect(failed.markFoundingRead).not.toHaveBeenCalled();
    // Claimed before the AI call, handed back when the read failed.
    expect(failed.claimFoundingRead).toHaveBeenCalledTimes(1);
    expect(failed.giveBackFoundingRead).toHaveBeenCalledWith(USER, "claimed-1");
    expect(failed.marker.at).toBeNull();
  });

  test("a founding read whose job ran out of time never spends the founding read", async () => {
    // Past the deadline the job answers a failure while produce may still be
    // finishing: marking the free read used then would take it for nothing.
    const h = harness([ok(CALIBRATION), ok(SLIM)], {
      withGenerationJob: async (spec, produce) => {
        await produce({
          jobId: "job-late",
          signal: new AbortController().signal,
          stillRunning: async () => false,
        });
        return {
          status: "done",
          jobId: "job-late",
          value: spec.failure("deadline_exceeded"),
          replayed: false,
        };
      },
    });

    const result = await h.run({ clientRequestId: REQUEST_ID });

    expect(result).toEqual({ success: false, error: "SERVER_GATEWAY_TIMEOUT" });
    expect(h.markFoundingRead).not.toHaveBeenCalled();
    expect(h.giveBackFoundingRead).toHaveBeenCalledTimes(1);
    expect(h.marker.at).toBeNull();
  });

  test("a failed re-read refunds the credit and releases the hourly slot", async () => {
    // The provider refused before generating anything (503, 429, 402): no
    // billed call, so both the credit and the slot come back.
    for (const status of [503, 429, 402]) {
      const h = harness([fail(status)], { foundingReadAt: USED_FOUNDING_READ });

      const result = await h.run({ clientRequestId: REQUEST_ID });

      expect(result.success).toBe(false);
      expect(h.credits).toEqual({ charged: 1, refunded: 1 });
      expect(h.store.rows[0].status).toBe("failed");
      expect(h.releaseRateLimit).toHaveBeenCalledTimes(1);
      expect(h.releaseRateLimit).toHaveBeenCalledWith(RATE_KEY, RESET_AT);
    }
  });

  test("a re-read the model answered still refunds the credit but keeps the hourly slot", async () => {
    // R-2 as amended: the slot comes back only when no billed call was made,
    // or deliberately bad photos would buy unlimited AI calls.
    const scenarios: Array<[string, AiResult[]]> = [
      ["two unusable Pass-2 replies", [ok(CALIBRATION), fail(502), fail(502)]],
      ["a Pass-2 timeout after Pass 1", [ok(CALIBRATION), fail(504)]],
      ["a Pass-1 timeout", [fail(504)]],
      ["a Pass-2 refusal after Pass 1", [ok(CALIBRATION), fail(503)]],
    ];
    for (const [name, replies] of scenarios) {
      const h = harness(replies, { foundingReadAt: USED_FOUNDING_READ });

      const result = await h.run({ clientRequestId: REQUEST_ID });

      expect({ name, success: result.success }).toEqual({ name, success: false });
      expect({ name, credits: h.credits }).toEqual({ name, credits: { charged: 1, refunded: 1 } });
      expect({ name, released: h.releaseRateLimit.mock.calls.length }).toEqual({
        name,
        released: 0,
      });
    }
  });

  test("the slot is released at most once, and never for a replayed or attached request", async () => {
    const store = new MemoryGenerationJobStore();
    store.seed(USER, 3);
    const releaseRateLimit = releaseMock();
    const first = harness([fail(503)], {
      foundingReadAt: USED_FOUNDING_READ,
      store,
      releaseRateLimit,
    });
    const replay = harness([], { foundingReadAt: USED_FOUNDING_READ, store, releaseRateLimit });

    const failed = await first.run({ clientRequestId: REQUEST_ID });
    const replayed = await replay.run({ clientRequestId: REQUEST_ID });

    expect(replayed).toEqual(failed);
    expect(replay.calls).toHaveLength(0);
    expect(releaseRateLimit).toHaveBeenCalledTimes(1);

    // Another request's failed job, answered to this one: not this slot's.
    const attached = harness([], {
      foundingReadAt: USED_FOUNDING_READ,
      withGenerationJob: async (spec) => ({
        status: "done",
        jobId: "job-of-another-request",
        value: spec.failure("ANALYSIS_GATEWAY_FAILURE"),
        replayed: true,
      }),
    });
    expect(await attached.run({ clientRequestId: REQUEST_ID })).toEqual({
      success: false,
      error: "ANALYSIS_GATEWAY_FAILURE",
    });
    expect(attached.releaseRateLimit).not.toHaveBeenCalled();
  });

  test("a second photo while a read is still running is asked to wait and keeps its slot", async () => {
    const h = harness([], {
      foundingReadAt: USED_FOUNDING_READ,
      withGenerationJob: async () => {
        throw new GenerationInFlightError(30);
      },
    });

    expect(await h.run({ clientRequestId: REQUEST_ID })).toEqual({
      success: false,
      error: "SERVER_GATEWAY_TIMEOUT",
    });
    expect(h.calls).toHaveLength(0);
    expect(h.releaseRateLimit).not.toHaveBeenCalled();
  });

  test("a re-read with no credits left is refused before any AI call and gives the slot back", async () => {
    const h = harness([ok(CALIBRATION), ok(SLIM)], {
      foundingReadAt: USED_FOUNDING_READ,
      dailyCredits: 0,
    });

    expect(await h.run({ clientRequestId: REQUEST_ID })).toEqual({
      success: false,
      error: INSUFFICIENT_CREDITS,
    });
    expect(h.calls).toHaveLength(0);
    expect(h.store.rows).toHaveLength(0);
    expect(h.releaseRateLimit).toHaveBeenCalledTimes(1);
    expect(h.releaseRateLimit).toHaveBeenCalledWith(RATE_KEY, RESET_AT);
  });

  test("the job input and result never contain the photo", async () => {
    const photo = Buffer.from("a portrait that must never be stored anywhere").toString("base64");
    const h = harness([ok(CALIBRATION), ok({ ...SLIM, hairColor: "Black", skinDepth: "Tan" })], {
      foundingReadAt: USED_FOUNDING_READ,
    });

    const result = await h.run({ imageBase64: photo, clientRequestId: REQUEST_ID });

    expect(result.success).toBe(true);
    const [job] = h.store.rows;
    const digest = createHash("sha256").update(photo).digest("hex").slice(0, 16);
    expect(job.input).toEqual({ forced: null, digest });
    expect(JSON.stringify(job.input)).not.toContain(photo);
    expect(JSON.stringify(job.result)).not.toContain(photo);
    expect(JSON.stringify(job.result)).not.toContain("base64");
    // The stored read is the answer she was given, minus the job id.
    if (!result.success) return;
    expect(job.result).toEqual({ profile: result.profile, telemetry: result.telemetry });
  });

  test("with generation jobs missing it runs today's withAiCredit path unchanged", async () => {
    const reread = harness([ok(CALIBRATION), ok(SLIM)], {
      foundingReadAt: USED_FOUNDING_READ,
      jobs: "missing",
    });
    const result = await reread.run({ clientRequestId: REQUEST_ID });
    expect(result.success).toBe(true);
    expect(result.success && "jobId" in result).toBe(false);
    expect(reread.withAiCredit).toHaveBeenCalledTimes(1);
    expect(reread.credits).toEqual({ charged: 1, refunded: 0 });
    expect(reread.store.rows).toHaveLength(0);

    const failedReread = harness([ok(CALIBRATION), fail(502), fail(502)], {
      foundingReadAt: USED_FOUNDING_READ,
      jobs: "missing",
    });
    expect((await failedReread.run()).success).toBe(false);
    expect(failedReread.credits).toEqual({ charged: 1, refunded: 1 });
    expect(failedReread.store.rows).toHaveLength(0);

    const founding = harness([ok(CALIBRATION), ok(SLIM)], { jobs: "missing" });
    expect((await founding.run()).success).toBe(true);
    expect(founding.withAiCredit).not.toHaveBeenCalled();
    expect(founding.markFoundingRead).toHaveBeenCalledTimes(1);
  });

  test("the server dossier write is off by default", async () => {
    const h = harness([ok(CALIBRATION), ok(SLIM)]);
    expect((await h.run()).success).toBe(true);
    expect(h.upserts).toHaveLength(0);

    // Kept behind the flag (R-10, owner question Q1), never deleted.
    const on = harness([ok(CALIBRATION), ok(SLIM)], { persistDossierOnServer: true });
    expect((await on.run()).success).toBe(true);
    expect(on.upserts).toHaveLength(1);
  });

  test("a founding check that cannot be read never makes the read free", async () => {
    // Fail closed: a read error or no profile row is not "founding read
    // unused". Nothing is called, nothing is charged, the slot comes back.
    for (const profileRead of [
      { data: null, error: { code: "57014", message: "canceling statement" } },
      { data: null, error: null },
    ]) {
      const h = harness([ok(CALIBRATION), ok(SLIM)], { profileRead });

      expect(await h.run({ clientRequestId: REQUEST_ID })).toEqual({
        success: false,
        error: "SERVER_GATEWAY_TIMEOUT",
      });
      expect(h.calls).toHaveLength(0);
      expect(h.store.rows).toHaveLength(0);
      expect(h.markFoundingRead).not.toHaveBeenCalled();
      expect(h.releaseRateLimit).toHaveBeenCalledTimes(1);
    }
  });
});

/** Resolves once `check` holds, polling every millisecond (bounded). */
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 2_000; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function gate() {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe("fix round 1: the hourly cap holds against refusals she can cause (I-1)", () => {
  test("a 400 and a 403 keep the slot and still refund the credit", async () => {
    // A corrupt or flagged image is hers to send: its refusal must not hand
    // the slot back, or the cap stops holding. Unknown statuses keep it too.
    for (const status of [400, 403, 413, 422, 418]) {
      const h = harness([fail(status)], { foundingReadAt: USED_FOUNDING_READ });

      const result = await h.run({ clientRequestId: REQUEST_ID });

      expect({ status, success: result.success }).toEqual({ status, success: false });
      expect({ status, credits: h.credits }).toEqual({
        status,
        credits: { charged: 1, refunded: 1 },
      });
      expect({ status, released: h.releaseRateLimit.mock.calls.length }).toEqual({
        status,
        released: 0,
      });
    }
  });

  test("only refusals she cannot cause give the slot back", async () => {
    for (const status of [401, 402, 404, 429, 500, 503]) {
      const h = harness([fail(status)], { foundingReadAt: USED_FOUNDING_READ });

      await h.run({ clientRequestId: REQUEST_ID });

      expect({ status, released: h.releaseRateLimit.mock.calls.length }).toEqual({
        status,
        released: 1,
      });
    }
  });

  test("50 bad requests hit the 10-an-hour cap, founding read and re-read alike", async () => {
    // The review's probe: every request's photo is refused with a 400 or 403.
    for (const status of [400, 403]) {
      for (const foundingReadAt of [null, USED_FOUNDING_READ]) {
        const hourly: HourlyLimit = { used: 0, limit: 10 };
        const h = harness(
          Array.from({ length: 50 }, () => fail(status)),
          { foundingReadAt, hourly, dailyCredits: 1 },
        );
        let refusedByCap = 0;
        for (let i = 0; i < 50; i += 1) {
          const r = await h.run({ clientRequestId: crypto.randomUUID() });
          if (!r.success && r.error === "ANALYSIS_RATE_LIMITED") refusedByCap += 1;
        }
        const label = { status, founding: foundingReadAt === null };
        expect({ ...label, calls: h.calls.length, refusedByCap }).toEqual({
          ...label,
          calls: 10,
          refusedByCap: 40,
        });
        expect(h.store.rows).toHaveLength(10);
        // Every failed paid read was refunded, and a founding read was never spent.
        expect(h.store.balance(USER)).toEqual({ daily: 1, purchased: 0 });
        if (foundingReadAt === null) expect(h.marker.at).toBeNull();
      }
    }
  });
});

describe("fix round 1: the founding read is claimed before the AI call", () => {
  test("two founding reads racing never get two free reads", async () => {
    // Both start together on the same member. Whatever the interleaving, at
    // most one read is free, the founding read is spent only by a free read
    // she received, and any other read was charged once or refused.
    for (const samePhoto of [false, true]) {
      const marker = newMarker();
      const store = new MemoryGenerationJobStore();
      store.seed(USER, 3);
      const held = gate();
      const a = harness([ok(CALIBRATION), ok(SLIM)], { marker, store, gate: held.promise });
      const b = harness([ok(CALIBRATION), ok(SLIM)], { marker, store, gate: held.promise });

      const both = Promise.all([
        a.run({ clientRequestId: crypto.randomUUID(), imageBase64: "cGhvdG8tYQ==" }),
        b.run({
          clientRequestId: crypto.randomUUID(),
          imageBase64: samePhoto ? "cGhvdG8tYQ==" : "cGhvdG8tYg==",
        }),
      ]);
      await until(() => a.calls.length + b.calls.length > 0, "a read to reach the AI");
      held.open();
      const results = await both;

      const freeJobs = store.rows.filter((r) => r.credit_state === "none");
      const successes = results.filter((r) => r.success);
      const label = { samePhoto };
      expect({ ...label, freeJobs: freeJobs.length <= 1 }).toEqual({ ...label, freeJobs: true });
      const freeSucceeded = freeJobs.some((r) => r.status === "succeeded");
      expect({ ...label, spent: marker.at !== null }).toEqual({ ...label, spent: freeSucceeded });
      expect(successes.length).toBeGreaterThanOrEqual(1);
      // Only the reads that ran the AI made calls; at most one read ran.
      expect(a.calls.length + b.calls.length).toBe(2);
    }
  });

  test("a second founding read while the first is reading is refused, or rides along free", async () => {
    // Deterministic order: the first has claimed and its job is running.
    for (const samePhoto of [false, true]) {
      const marker = newMarker();
      const store = new MemoryGenerationJobStore();
      store.seed(USER, 3);
      const held = gate();
      const first = harness([ok(CALIBRATION), ok(SLIM)], { marker, store, gate: held.promise });
      const second = harness([], { marker, store });

      const reading = first.run({
        clientRequestId: crypto.randomUUID(),
        imageBase64: "cGhvdG8tYQ==",
      });
      await until(() => store.rows.some((r) => r.status === "running"), "the first job");
      let secondDone = false;
      const asking = second
        .run({
          clientRequestId: crypto.randomUUID(),
          imageBase64: samePhoto ? "cGhvdG8tYQ==" : "cGhvdG8tYg==",
        })
        .finally(() => {
          secondDone = true;
        });
      // A different photo is refused at once; the same photo waits on the job.
      await until(() => secondDone || store.calls.get > 0, "the second read to wait or be refused");
      held.open();
      const [firstResult, secondResult] = await Promise.all([reading, asking]);

      expect(firstResult.success).toBe(true);
      if (samePhoto) {
        // The same photo attaches to the running read: her one free result.
        expect(secondResult).toEqual(firstResult);
      } else {
        expect(secondResult).toEqual({ success: false, error: "SERVER_GATEWAY_TIMEOUT" });
      }
      expect(store.rows).toHaveLength(1);
      expect(store.rows[0].credit_state).toBe("none");
      expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
      expect(second.calls).toHaveLength(0);
      expect(first.claimFoundingRead).toHaveBeenCalledTimes(1);
      expect(second.claimFoundingRead).not.toHaveBeenCalled();
      expect(marker.at).not.toBeNull();
    }
  });

  test("a claim lost a moment after the check is refused, never charged and never free", async () => {
    // Her check read NULL, but another request claimed it first.
    const marker = newMarker("claimed-by-another-request");
    const h = harness([ok(CALIBRATION), ok(SLIM)], {
      marker,
      profileRead: {
        data: {
          skin_undertone: null,
          color_season: null,
          color_profile: null,
          founding_color_read_at: null,
        },
        error: null,
      },
    });

    expect(await h.run({ clientRequestId: REQUEST_ID })).toEqual({
      success: false,
      error: "SERVER_GATEWAY_TIMEOUT",
    });
    expect(h.calls).toHaveLength(0);
    expect(h.store.rows).toHaveLength(0);
    expect(h.giveBackFoundingRead).not.toHaveBeenCalled();
    expect(h.releaseRateLimit).not.toHaveBeenCalled();
    expect(marker.at).toBe("claimed-by-another-request");
  });

  test("a claim that cannot be written never makes the read free", async () => {
    const h = harness([ok(CALIBRATION), ok(SLIM)], { claimError: true });

    expect(await h.run({ clientRequestId: REQUEST_ID })).toEqual({
      success: false,
      error: "SERVER_GATEWAY_TIMEOUT",
    });
    expect(h.calls).toHaveLength(0);
    expect(h.store.rows).toHaveLength(0);
    expect(h.releaseRateLimit).toHaveBeenCalledTimes(1);
  });

  test("on the legacy path two racing founding reads are one free, and one paid or refused", async () => {
    // No job serialises them here: the claim alone decides.
    const marker = newMarker();
    const held = gate();
    const a = harness([ok(CALIBRATION), ok(SLIM)], { marker, jobs: "missing", gate: held.promise });
    const b = harness([ok(CALIBRATION), ok(SLIM)], { marker, jobs: "missing", gate: held.promise });

    const both = Promise.all([a.run(), b.run()]);
    await until(() => a.calls.length + b.calls.length > 0, "a read to reach the AI");
    await new Promise((resolve) => setTimeout(resolve, 20));
    held.open();
    const results = await both;

    const successes = results.filter((r) => r.success).length;
    const paid = a.withAiCredit.mock.calls.length + b.withAiCredit.mock.calls.length;
    const refused = results.filter(
      (r) => !r.success && r.error === "SERVER_GATEWAY_TIMEOUT",
    ).length;
    // Exactly one free read (it never goes through withAiCredit); the other
    // read was either charged once or refused before any AI call.
    expect(successes - paid).toBe(1);
    expect(paid + refused).toBe(1);
    expect(a.credits.charged + b.credits.charged).toBe(paid);
    expect(a.calls.length + b.calls.length).toBe(2 * successes);
    expect(marker.at).not.toBeNull();
  });

  test("a successful founding read stays spent even when its job row cannot be re-read (M-1)", async () => {
    const h = harness([ok(CALIBRATION), ok(SLIM)]);
    h.store.get = async () => {
      throw new Error("connection reset");
    };

    expect((await h.run({ clientRequestId: REQUEST_ID })).success).toBe(true);
    expect(h.giveBackFoundingRead).not.toHaveBeenCalled();
    expect(h.markFoundingRead).toHaveBeenCalledTimes(1);
    expect(h.marker.at).not.toBeNull();
  });

  test("a founding read that hits a refusal gives the claim back, on the legacy path too", async () => {
    for (const jobs of ["installed", "missing"] as const) {
      const h = harness([fail(503)], { jobs });

      expect((await h.run({ clientRequestId: REQUEST_ID })).success).toBe(false);
      expect({ jobs, given: h.giveBackFoundingRead.mock.calls.length }).toEqual({ jobs, given: 1 });
      expect({ jobs, marker: h.marker.at }).toEqual({ jobs, marker: null });
    }
  });
});

type QueryCall = { method: string; args: unknown[] };

/** A service-role client that records the one update chain it is given and
 * answers `answer` (or throws it). */
function adminClient(answer: { data: unknown; error: unknown } | Error) {
  const recorded: QueryCall[] = [];
  const chain = {
    update: (...args: unknown[]) => (recorded.push({ method: "update", args }), chain),
    eq: (...args: unknown[]) => (recorded.push({ method: "eq", args }), chain),
    is: (...args: unknown[]) => (recorded.push({ method: "is", args }), chain),
    select: async (...args: unknown[]) => {
      recorded.push({ method: "select", args });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  const client = {
    from: (table: string) => (recorded.push({ method: "from", args: [table] }), chain),
  };
  return { client: async () => client as never, recorded };
}

describe("fix round 1: the claim and the give-back are conditional writes", () => {
  const NOW = Date.parse("2026-10-07T10:00:00.123Z");

  test("the claim moves the marker from NULL only, and keeps the text it was given", async () => {
    const db = adminClient({
      data: [{ founding_color_read_at: "2026-10-07T10:00:00.123+00:00" }],
      error: null,
    });

    const claim = await claimFoundingColorRead(USER, db.client, () => NOW);

    expect(claim).toEqual({ outcome: "claimed", claimedAt: "2026-10-07T10:00:00.123+00:00" });
    expect(db.recorded).toEqual([
      { method: "from", args: ["profiles"] },
      { method: "update", args: [{ founding_color_read_at: "2026-10-07T10:00:00.123Z" }] },
      { method: "eq", args: ["id", USER] },
      { method: "is", args: ["founding_color_read_at", null] },
      { method: "select", args: ["founding_color_read_at"] },
    ]);
  });

  test("a claim that matched no row was taken; an error or a throw is never a claim", async () => {
    expect(
      await claimFoundingColorRead(USER, adminClient({ data: [], error: null }).client),
    ).toEqual({
      outcome: "taken",
    });
    expect(
      await claimFoundingColorRead(
        USER,
        adminClient({ data: null, error: { code: "57014", message: "timeout" } }).client,
      ),
    ).toEqual({ outcome: "error" });
    expect(await claimFoundingColorRead(USER, adminClient(new Error("reset")).client)).toEqual({
      outcome: "error",
    });
  });

  test("the give-back clears only this request's own claim", async () => {
    const db = adminClient({ data: [{ id: USER }], error: null });

    await giveBackFoundingColorRead(USER, "2026-10-07T10:00:00.123+00:00", db.client);

    expect(db.recorded).toEqual([
      { method: "from", args: ["profiles"] },
      { method: "update", args: [{ founding_color_read_at: null }] },
      { method: "eq", args: ["id", USER] },
      { method: "eq", args: ["founding_color_read_at", "2026-10-07T10:00:00.123+00:00"] },
      { method: "select", args: ["id"] },
    ]);
  });

  test("a failed give-back is retried once and never throws", async () => {
    const db = adminClient(new Error("connection reset"));

    await giveBackFoundingColorRead(USER, "2026-10-07T10:00:00.123+00:00", db.client);

    expect(db.recorded.filter((c) => c.method === "update")).toHaveLength(2);
  });
});

describe("fix round 1: replays, hidden hair, null replies, the legacy path, a real attach", () => {
  test("a stored hairColor outside HAIR_COLORS replays as null and never fails a paid replay (M-2)", async () => {
    const store = new MemoryGenerationJobStore();
    store.seed(USER, 3);
    const first = harness(
      [ok(CALIBRATION), ok({ ...SLIM, hairColor: "Black", skinDepth: "Tan" })],
      {
        foundingReadAt: USED_FOUNDING_READ,
        store,
      },
    );
    const read = await first.run({ clientRequestId: REQUEST_ID });
    expect(read.success).toBe(true);
    // A later release renames both lists; her stored read still says the old words.
    const stored = store.rows[0].result as { profile: Record<string, unknown> };
    stored.profile.hairColor = "Blue black";
    stored.profile.skinDepth = "Olive";

    const replay = await harness([], { foundingReadAt: USED_FOUNDING_READ, store }).run({
      clientRequestId: REQUEST_ID,
    });

    expect(replay.success).toBe(true);
    if (!replay.success) return;
    expect(replay.profile.hairColor).toBeNull();
    expect("skinDepth" in replay.profile && replay.profile.skinDepth !== undefined).toBe(false);
    expect(replay.profile.season).toBe("Autumn");
  });

  test("hair that cannot be seen comes back as null, never a guess (M-4)", async () => {
    const h = harness([ok(CALIBRATION), ok({ ...SLIM, hairColor: null, skinDepth: "Light" })]);

    const result = await h.run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.profile.hairColor).toBeNull();
    expect(result.profile.skinDepth).toBe("Light");
    const tool = pass2(h).toolDef as {
      function: {
        parameters: { properties: Record<string, { type?: unknown; enum?: unknown[] }> };
      };
    };
    expect(tool.function.parameters.properties.hairColor.type).toEqual(["string", "null"]);
    expect(tool.function.parameters.properties.hairColor.enum).toEqual([...HAIR_COLORS, null]);
    expect(pass2(h).system).toContain(
      "If her hair is covered or out of the photo, answer `hairColor` null. Never guess it.",
    );
  });

  test("a JSON null reply is refused as unusable and refunded (M-5)", async () => {
    const h = harness([ok(null), ok(null)], { foundingReadAt: USED_FOUNDING_READ });

    expect(await h.run({ clientRequestId: REQUEST_ID })).toEqual({
      success: false,
      error: "ANALYSIS_PARSING_FAILED",
    });
    expect(h.credits).toEqual({ charged: 1, refunded: 1 });
    // The model answered: a billed call, so the slot stays spent.
    expect(h.releaseRateLimit).not.toHaveBeenCalled();
  });

  test("on the legacy path the slot comes back only for refusals she cannot cause (M-3)", async () => {
    const refused = harness([fail(503)], { foundingReadAt: USED_FOUNDING_READ, jobs: "missing" });
    expect((await refused.run()).success).toBe(false);
    expect(refused.credits).toEqual({ charged: 1, refunded: 1 });
    expect(refused.releaseRateLimit).toHaveBeenCalledTimes(1);
    expect(refused.releaseRateLimit).toHaveBeenCalledWith(RATE_KEY, RESET_AT);

    const herPhoto = harness([fail(400)], { foundingReadAt: USED_FOUNDING_READ, jobs: "missing" });
    expect((await herPhoto.run()).success).toBe(false);
    expect(herPhoto.credits).toEqual({ charged: 1, refunded: 1 });
    expect(herPhoto.releaseRateLimit).not.toHaveBeenCalled();

    const answered = harness([ok(CALIBRATION), fail(502), fail(502)], {
      foundingReadAt: USED_FOUNDING_READ,
      jobs: "missing",
    });
    expect((await answered.run()).success).toBe(false);
    expect(answered.releaseRateLimit).not.toHaveBeenCalled();

    const broke = harness([ok(CALIBRATION), ok(SLIM)], {
      foundingReadAt: USED_FOUNDING_READ,
      jobs: "missing",
      legacyOutOfCredits: true,
    });
    expect(await broke.run()).toEqual({ success: false, error: INSUFFICIENT_CREDITS });
    expect(broke.calls).toHaveLength(0);
    expect(broke.releaseRateLimit).toHaveBeenCalledTimes(1);
  });

  test("a real attach: the same request while it is still reading waits for it and keeps its slot (M-3)", async () => {
    for (const outcome of ["succeeds", "is refused"] as const) {
      const store = new MemoryGenerationJobStore();
      store.seed(USER, 3);
      const releaseRateLimit = releaseMock();
      const held = gate();
      const replies = outcome === "succeeds" ? [ok(CALIBRATION), ok(SLIM)] : [fail(503)];
      const first = harness(replies, {
        foundingReadAt: USED_FOUNDING_READ,
        store,
        releaseRateLimit,
        gate: held.promise,
      });
      const again = harness([], { foundingReadAt: USED_FOUNDING_READ, store, releaseRateLimit });

      const reading = first.run({ clientRequestId: REQUEST_ID });
      await until(() => store.rows.some((r) => r.status === "running"), "the first job");
      const waiting = again.run({ clientRequestId: REQUEST_ID });
      // Only a waiting request reads the job row back: the second is polling.
      await until(() => store.calls.get > 0, "the second request to poll the running job");
      held.open();
      const [firstResult, attachedResult] = await Promise.all([reading, waiting]);

      expect({ outcome, same: attachedResult }).toEqual({ outcome, same: firstResult });
      expect(store.rows).toHaveLength(1);
      expect(store.balance(USER)).toEqual(
        outcome === "succeeds" ? { daily: 2, purchased: 0 } : { daily: 3, purchased: 0 },
      );
      expect(again.calls).toHaveLength(0);
      // Only the request that read (and was refused) hands its own slot back.
      expect({ outcome, released: releaseRateLimit.mock.calls.length }).toEqual({
        outcome,
        released: outcome === "succeeds" ? 0 : 1,
      });
    }
  });
});
