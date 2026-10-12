import { describe, expect, mock, test } from "bun:test";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { INSUFFICIENT_CREDITS } from "@/lib/credits";
import { GenerationInFlightError } from "@/lib/generation-jobs.server";
import type { BodyScanResult } from "@/server/services/body-scan";
import { handleAnalysisBodyScan, type HandleAnalysisBodyScanDeps } from "./body-scan";

const REQ = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const VALID_INPUT = { bodyImageBase64: "d29ybGQ=" };

const SUCCESS: BodyScanResult = {
  success: true,
  silhouette: "Hourglass",
  jobId: "11111111-2222-4333-8444-555555555555",
};

function fakeDeps(overrides: Partial<HandleAnalysisBodyScanDeps> = {}): HandleAnalysisBodyScanDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    runBodyScanForUser: mock(async () => SUCCESS),
    ...overrides,
  } as HandleAnalysisBodyScanDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/analysis/body-scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/analysis/body-scan", () => {
  test("401 without a bearer token", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleAnalysisBodyScan(postRequest(VALID_INPUT), deps);

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    expect(deps.runBodyScanForUser).not.toHaveBeenCalled();
  });

  test("200 with the suggested silhouette and the job id, the request id passed through", async () => {
    const deps = fakeDeps();
    const res = await handleAnalysisBodyScan(
      postRequest({ ...VALID_INPUT, clientRequestId: REQ }, "good-token"),
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUCCESS);
    const call = (deps.runBodyScanForUser as ReturnType<typeof mock>).mock.calls[0];
    expect(call[2]).toEqual({ ...VALID_INPUT, clientRequestId: REQ });
  });

  test("failures ride 200 with a code", async () => {
    for (const error of [
      "BODY_SCAN_NOT_FULL_LENGTH",
      "BODY_SCAN_RATE_LIMITED",
      "BODY_SCAN_UNAVAILABLE",
      INSUFFICIENT_CREDITS,
    ]) {
      const deps = fakeDeps({
        runBodyScanForUser: mock(async () => ({ success: false as const, error })),
      });
      const res = await handleAnalysisBodyScan(postRequest(VALID_INPUT, "good-token"), deps);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: false, error });
    }
  });

  test("another scan still running answers 429 with retryAfter", async () => {
    const deps = fakeDeps({
      runBodyScanForUser: mock(async () => {
        throw new GenerationInFlightError(30);
      }),
    });

    const res = await handleAnalysisBodyScan(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toMatchObject({ code: "RATE_LIMITED", retryAfter: 30 });
  });

  test("invalid input answers 400 and the scan never runs", async () => {
    const deps = fakeDeps();
    for (const body of [{}, { bodyImageBase64: "" }, { ...VALID_INPUT, clientRequestId: "x" }]) {
      const res = await handleAnalysisBodyScan(postRequest(body, "good-token"), deps);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    }
    expect(deps.runBodyScanForUser).not.toHaveBeenCalled();
  });
});
