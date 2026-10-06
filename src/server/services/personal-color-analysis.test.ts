import { describe, expect, mock, test } from "bun:test";
import type { AiResult, aiChatCompletion } from "@/lib/ai.server";
import {
  analyzePersonalColorForUser,
  type PersonalColorAnalysisDeps,
} from "./personal-color-analysis";

const USER = "user-1";
const IMAGE = { imageBase64: "aGVsbG8=" };
const S = 1_000;

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
};

function harness(replies: AiResult[], opts: HarnessOptions = {}) {
  const queue = [...replies];
  const durations = [...(opts.callDurationsMs ?? [])];
  let clock = 0;
  const calls: Array<{ tool: string; timeoutMs: number | undefined }> = [];
  const credits = { charged: 0, refunded: 0 };
  const upserts: unknown[] = [];

  const member = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              skin_undertone: null,
              color_season: null,
              color_profile: null,
              founding_color_read_at: opts.foundingReadAt ?? null,
            },
            error: null,
          }),
        }),
      }),
      upsert: async (row: unknown) => {
        upserts.push(row);
        return { error: opts.upsertError ?? null };
      },
    }),
  } as unknown as Parameters<typeof analyzePersonalColorForUser>[0];

  const markFoundingRead = mock(async (_userId: string) => {});

  const deps: PersonalColorAnalysisDeps = {
    aiChatCompletion: mock(async (...args: Parameters<typeof aiChatCompletion>) => {
      const [, tool, , options] = args;
      calls.push({ tool: tool.function.name, timeoutMs: options?.timeoutMs });
      const duration = durations.shift() ?? 20 * S;
      clock += duration === "whole" ? (options?.timeoutMs ?? Infinity) : duration;
      const next = queue.shift();
      if (!next) throw new Error("unexpected extra AI call");
      return next;
    }),
    isAiConfigured: () => true,
    consumeRateLimit: mock(async () => ({
      allowed: true,
      remaining: 9,
      reset_at: "",
      retry_after_seconds: 0,
    })),
    withAiCredit: (async (_supabase, _userId, produce, creditOpts) => {
      credits.charged += 1;
      const result = await produce();
      if (creditOpts?.refundIf?.(result)) credits.refunded += 1;
      return result;
    }) as PersonalColorAnalysisDeps["withAiCredit"],
    markFoundingRead,
    now: () => clock,
  };

  return {
    run: () => analyzePersonalColorForUser(member, USER, IMAGE, deps),
    elapsedMs: () => clock,
    calls,
    credits,
    upserts,
    markFoundingRead,
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
    const h = harness([ok(CALIBRATION), ok(SLIM)], { upsertError: RLS_REFUSAL });

    const result = await h.run();

    expect(result.success).toBe(true);
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
