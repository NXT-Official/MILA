import { describe, expect, mock, test } from "bun:test";
import { handleAnalysisOutfit, type HandleAnalysisOutfitDeps } from "./outfit";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { RateLimitExceededError } from "@/lib/rate-limit.server";

const VALID_INPUT = {
  imageUrl: "https://mila.test/storage/v1/object/public/outfits/user-1/photo.jpg",
  bodyType: "Hourglass",
  colorSeason: "Bright Winter",
};

function fakeDeps(overrides: Partial<HandleAnalysisOutfitDeps> = {}): HandleAnalysisOutfitDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    analyzeOutfitForUser: mock(async () => ({
      color_match: "Great match",
      silhouette: "Flattering",
      overall_score: 88,
      verdict: "Looks great, try a belt.",
    })),
    ...overrides,
  } as HandleAnalysisOutfitDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/analysis/outfit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/analysis/outfit", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleAnalysisOutfit(postRequest(VALID_INPUT), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the analysis", async () => {
    const deps = fakeDeps();
    const res = await handleAnalysisOutfit(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.overall_score).toBe(88);
  });

  test("rate limited -> 429 RATE_LIMITED with retryAfter", async () => {
    const deps = fakeDeps({
      analyzeOutfitForUser: mock(async () => {
        throw new RateLimitExceededError(120);
      }),
    });

    const res = await handleAnalysisOutfit(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(json.error.retryAfter).toBe(120);
  });

  test("clientRequestId gives inFlight report and passes { status: running, jobId } through", async () => {
    const clientRequestId = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
    const deps = fakeDeps({
      analyzeOutfitForUser: mock(async () => ({ status: "running", jobId: "job-9" })),
    });
    const res = await handleAnalysisOutfit(
      postRequest({ ...VALID_INPUT, clientRequestId, saveToHistory: true }, "good-token"),
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "running", jobId: "job-9" });
    const call = (deps.analyzeOutfitForUser as ReturnType<typeof mock>).mock.calls[0];
    expect(call[2]).toMatchObject({ clientRequestId, saveToHistory: true });
    expect(call[3]).toEqual({ inFlight: "report" });
  });

  test("without clientRequestId the answer is today's shape and the call attaches", async () => {
    const deps = fakeDeps();
    const res = await handleAnalysisOutfit(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(json).toEqual({
      color_match: "Great match",
      silhouette: "Flattering",
      overall_score: 88,
      verdict: "Looks great, try a belt.",
    });
    const call = (deps.analyzeOutfitForUser as ReturnType<typeof mock>).mock.calls[0];
    expect(call[3]).toEqual({ inFlight: "attach" });
  });

  test("a malformed clientRequestId -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handleAnalysisOutfit(
      postRequest({ ...VALID_INPUT, clientRequestId: "nope" }, "good-token"),
      deps,
    );
    expect(res.status).toBe(400);
    expect(deps.analyzeOutfitForUser).not.toHaveBeenCalled();
  });

  test("invalid image URL -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handleAnalysisOutfit(
      postRequest({ ...VALID_INPUT, imageUrl: "not-a-url" }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.analyzeOutfitForUser).not.toHaveBeenCalled();
  });
});
