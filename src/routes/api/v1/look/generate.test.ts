import { describe, expect, mock, test } from "bun:test";
import { handleLookGenerate, type HandleLookGenerateDeps } from "./generate";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { InsufficientCreditsError } from "@/lib/credits";
import { GenerationInFlightError } from "@/lib/generation-jobs.server";

const VALID_INPUT = {
  bodyType: "Hourglass",
  colorSeason: "Bright Winter",
  weather: "Sunny, 72F",
  vibe: "Work",
};

function fakeDeps(overrides: Partial<HandleLookGenerateDeps> = {}): HandleLookGenerateDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    generateLookForUser: mock(async () => ({
      outfit: { headline: "H", description: "D", styling_notes: "S" },
      hair: { style: "Low bun", execution_tip: "Use a comb" },
      makeup: null,
      vibe_alignment_score: 8,
      forecastRetrievedAt: null,
    })),
    ...overrides,
  } as HandleLookGenerateDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/look/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/look/generate", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleLookGenerate(postRequest(VALID_INPUT), deps);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the composed look", async () => {
    const deps = fakeDeps();

    const res = await handleLookGenerate(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.outfit.headline).toBe("H");
    expect(json.vibe_alignment_score).toBe(8);
    expect(deps.generateLookForUser).toHaveBeenCalledWith(
      {},
      "user-1",
      expect.objectContaining({ bodyType: "Hourglass" }),
    );
  });

  test("insufficient credits -> 402 INSUFFICIENT_CREDITS", async () => {
    const deps = fakeDeps({
      generateLookForUser: mock(async () => {
        throw new InsufficientCreditsError();
      }),
    });

    const res = await handleLookGenerate(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(402);
    expect(json.error.code).toBe("INSUFFICIENT_CREDITS");
  });

  test("invalid body -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();

    const res = await handleLookGenerate(postRequest({ bodyType: "" }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.generateLookForUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/look/generate — generation jobs", () => {
  const REQUEST_ID = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";

  test("a clientRequestId asks for the running shape and passes it through", async () => {
    const deps = fakeDeps({
      generateLookForUser: mock(async () => ({ status: "running", jobId: "job-1" })),
    } as unknown as Partial<HandleLookGenerateDeps>);

    const res = await handleLookGenerate(
      postRequest({ ...VALID_INPUT, clientRequestId: REQUEST_ID }, "good-token"),
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "running", jobId: "job-1" });
    expect(deps.generateLookForUser).toHaveBeenCalledWith(
      {},
      "user-1",
      expect.objectContaining({ clientRequestId: REQUEST_ID }),
      { inFlight: "report" },
    );
  });

  test("the look answer keeps every field and adds the job id", async () => {
    const deps = fakeDeps({
      generateLookForUser: mock(async () => ({
        outfit: { headline: "H", description: "D", styling_notes: "S" },
        hair: { style: "Low bun", execution_tip: "Use a comb" },
        makeup: null,
        vibe_alignment_score: 8,
        forecastRetrievedAt: null,
        jobId: "job-1",
      })),
    });

    const res = await handleLookGenerate(
      postRequest({ ...VALID_INPUT, clientRequestId: REQUEST_ID }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(json.outfit.headline).toBe("H");
    expect(json.jobId).toBe("job-1");
  });

  test("the look answer carries whether it was a replay (round 5)", async () => {
    const deps = fakeDeps({
      generateLookForUser: mock(async () => ({
        outfit: { headline: "H", description: "D", styling_notes: "S" },
        hair: { style: "Low bun", execution_tip: "Use a comb" },
        makeup: null,
        vibe_alignment_score: 8,
        forecastRetrievedAt: null,
        jobId: "job-1",
        replayed: true,
      })),
    });

    const res = await handleLookGenerate(
      postRequest({ ...VALID_INPUT, clientRequestId: REQUEST_ID }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(json).toMatchObject({ jobId: "job-1", replayed: true });
  });

  test("a clientRequestId that is not a UUID -> 400 VALIDATION_FAILED, nothing charged", async () => {
    const deps = fakeDeps();
    const res = await handleLookGenerate(
      postRequest({ ...VALID_INPUT, clientRequestId: "not-a-uuid" }, "good-token"),
      deps,
    );

    expect(res.status).toBe(400);
    expect(deps.generateLookForUser).not.toHaveBeenCalled();
  });

  test("an old build stuck behind a running look -> 429 RATE_LIMITED with retryAfter", async () => {
    const deps = fakeDeps({
      generateLookForUser: mock(async () => {
        throw new GenerationInFlightError(42);
      }),
    });

    const res = await handleLookGenerate(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(json.error.retryAfter).toBe(42);
    expect(json.error.message).not.toContain("—");
  });
});
