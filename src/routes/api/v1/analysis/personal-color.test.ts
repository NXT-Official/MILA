import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  handleAnalysisPersonalColor,
  type HandleAnalysisPersonalColorDeps,
} from "./personal-color";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { INSUFFICIENT_CREDITS } from "@/lib/credits";
import type { ColorAnalysisResult } from "@/server/services/personal-color-analysis";

const VALID_INPUT = { imageBase64: "aGVsbG8=" };

const SUCCESS = {
  success: true,
  profile: { season: "Spring", subSeason: "Spring Light" },
  telemetry: { forcedDiagnostic: false },
} as unknown as ColorAnalysisResult;

function fakeDeps(
  overrides: Partial<HandleAnalysisPersonalColorDeps> = {},
): HandleAnalysisPersonalColorDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    analyzePersonalColorForUser: mock(async () => SUCCESS),
    ...overrides,
  } as HandleAnalysisPersonalColorDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/analysis/personal-color", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/analysis/personal-color", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleAnalysisPersonalColor(postRequest(VALID_INPUT), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the profile result", async () => {
    const res = await handleAnalysisPersonalColor(
      postRequest(VALID_INPUT, "good-token"),
      fakeDeps(),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.profile.season).toBe("Spring");
  });

  test("rate limited -> 200 with the failure body (the §6 pass-through)", async () => {
    const deps = fakeDeps({
      analyzePersonalColorForUser: mock(
        async () => ({ success: false, error: "ANALYSIS_RATE_LIMITED" }) as ColorAnalysisResult,
      ),
    });

    const res = await handleAnalysisPersonalColor(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    // Read failures ride a 200 as `{ success: false, error }` — this endpoint's
    // own contract — so the client maps the code, not the status.
    expect(res.status).toBe(200);
    expect(json.success).toBe(false);
    expect(json.error).toBe("ANALYSIS_RATE_LIMITED");
  });

  test("out of credits -> 200 with INSUFFICIENT_CREDITS (the paywall trigger)", async () => {
    const deps = fakeDeps({
      analyzePersonalColorForUser: mock(
        async () => ({ success: false, error: INSUFFICIENT_CREDITS }) as ColorAnalysisResult,
      ),
    });

    const res = await handleAnalysisPersonalColor(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    // The member's client turns this code into the paywall sheet, never copy.
    expect(res.status).toBe(200);
    expect(json.success).toBe(false);
    expect(json.error).toBe(INSUFFICIENT_CREDITS);
  });

  test("passes clientRequestId through and answers jobId", async () => {
    const clientRequestId = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
    const deps = fakeDeps({
      analyzePersonalColorForUser: mock(
        async () => ({ ...SUCCESS, jobId: "job-1" }) as ColorAnalysisResult,
      ),
    });

    const res = await handleAnalysisPersonalColor(
      postRequest({ ...VALID_INPUT, clientRequestId }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(deps.analyzePersonalColorForUser).toHaveBeenCalledWith(expect.anything(), "user-1", {
      ...VALID_INPUT,
      clientRequestId,
    });
    expect(json.success).toBe(true);
    expect(json.jobId).toBe("job-1");
  });

  test("a clientRequestId that is not a uuid -> 400 VALIDATION_FAILED, service never runs", async () => {
    const deps = fakeDeps();
    const res = await handleAnalysisPersonalColor(
      postRequest({ ...VALID_INPUT, clientRequestId: "press-1" }, "good-token"),
      deps,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    expect(deps.analyzePersonalColorForUser).not.toHaveBeenCalled();
  });

  test("invalid input -> 400 VALIDATION_FAILED, service never runs", async () => {
    const deps = fakeDeps();
    const res = await handleAnalysisPersonalColor(
      postRequest({ ...VALID_INPUT, imageBase64: "" }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.analyzePersonalColorForUser).not.toHaveBeenCalled();
  });

  test("the service keeps the founding read free — once, marker-based (source wiring)", () => {
    const src = readFileSync(
      join(import.meta.dir, "../../../../server/services/personal-color-analysis.ts"),
      "utf8",
    );
    // QA MW-10: founding-ness is read from a service-role-only marker column,
    // not from the member-writable dossier columns. D-W1 fix round 1: it is
    // then claimed with one conditional update before the AI call, so only
    // one racing read can be free.
    expect(src).toContain("const foundingUnused = !profileRow?.founding_color_read_at;");
    expect(src).toContain('.is("founding_color_read_at", null)');
    expect(src).toContain("const foundingRead = foundingClaim !== null;");
    expect(src).toContain("if (foundingRead) return await produce();");
    expect(src).toContain("DEFAULT_AI_CREDITS is 0");
    expect(src).toContain("founding_color_read_at: new Date().toISOString()");
    expect(src).not.toContain("foundingRead = !hasColorDossier");
  });
});
