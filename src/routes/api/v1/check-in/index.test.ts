import { describe, expect, mock, test } from "bun:test";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { INSUFFICIENT_CREDITS } from "@/lib/credits";
import { GenerationInFlightError } from "@/lib/generation-jobs.server";
import type { CheckInResult } from "@/server/services/check-in";
import { handleCheckIn, type HandleCheckInDeps } from "./index";

const REQ = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const VALID_INPUT = { faceImageBase64: "aGVsbG8=", bodyImageBase64: "d29ybGQ=" };

const SUCCESS: CheckInResult = {
  success: true,
  read: {
    skinDepth: "Medium",
    hairColor: "Auburn",
    hairLength: "Long",
    silhouette: "Pear",
    bodyPhotoUsable: true,
  },
  jobId: "11111111-2222-4333-8444-555555555555",
};

function fakeDeps(overrides: Partial<HandleCheckInDeps> = {}): HandleCheckInDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    runCheckInForUser: mock(async () => SUCCESS),
    ...overrides,
  } as HandleCheckInDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/check-in", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/check-in", () => {
  test("401 without a bearer token", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleCheckIn(postRequest(VALID_INPUT), deps);

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    expect(deps.runCheckInForUser).not.toHaveBeenCalled();
  });

  test("200 with her read and the job id, the request id passed through", async () => {
    const deps = fakeDeps();
    const res = await handleCheckIn(
      postRequest({ ...VALID_INPUT, clientRequestId: REQ }, "good-token"),
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUCCESS);
    const call = (deps.runCheckInForUser as ReturnType<typeof mock>).mock.calls[0];
    expect(call[1]).toBe("user-1");
    expect(call[2]).toEqual({ ...VALID_INPUT, clientRequestId: REQ });
  });

  test("failures ride 200 with a code", async () => {
    for (const error of [
      "CHECK_IN_RATE_LIMITED",
      "CHECK_IN_PHOTO_TOO_LARGE",
      "CHECK_IN_UNAVAILABLE",
      INSUFFICIENT_CREDITS,
    ]) {
      const deps = fakeDeps({
        runCheckInForUser: mock(async () => ({ success: false as const, error })),
      });
      const res = await handleCheckIn(postRequest(VALID_INPUT, "good-token"), deps);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: false, error });
    }
  });

  test("another check-in with other photos still running answers 429 with retryAfter", async () => {
    const deps = fakeDeps({
      runCheckInForUser: mock(async () => {
        throw new GenerationInFlightError(42);
      }),
    });

    const res = await handleCheckIn(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(json.error.retryAfter).toBe(42);
  });

  test("invalid input answers 400 and the read never runs", async () => {
    const deps = fakeDeps();
    for (const body of [
      {},
      { faceImageBase64: "" },
      { ...VALID_INPUT, clientRequestId: "not-a-uuid" },
    ]) {
      const res = await handleCheckIn(postRequest(body, "good-token"), deps);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    }
    expect(deps.runCheckInForUser).not.toHaveBeenCalled();
  });

  test("a photo far past the size cap is refused with plain copy", async () => {
    const deps = fakeDeps();
    const res = await handleCheckIn(
      postRequest({ faceImageBase64: "A".repeat(15_000_001) }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toEqual({
      code: "VALIDATION_FAILED",
      message: "That photo is too large. Try another one.",
    });
    expect(deps.runCheckInForUser).not.toHaveBeenCalled();
  });
});
