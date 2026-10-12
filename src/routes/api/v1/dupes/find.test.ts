import { describe, expect, mock, test } from "bun:test";
import { handleDupesFind, type HandleDupesFindDeps } from "./find";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { InsufficientCreditsError } from "@/lib/credits";

const VALID_INPUT = { imageUrl: "https://storage.mila.app/outfits/user-1/a.jpg" };

const INSPIRATION = {
  name: "cream quilted top-handle vanity case",
  category: "Bags",
  primary_color: "cream",
  color_undertone: "Warm",
  silhouette_tags: ["structured", "top-handle"],
};

function fakeDeps(overrides: Partial<HandleDupesFindDeps> = {}): HandleDupesFindDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    findDupesForUser: mock(async () => ({ inspiration: INSPIRATION, dupes: [] })),
    ...overrides,
  } as HandleDupesFindDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/dupes/find", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/dupes/find", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleDupesFind(postRequest(VALID_INPUT), deps);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with inspiration and dupes", async () => {
    const deps = fakeDeps();

    const res = await handleDupesFind(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.inspiration.category).toBe("Bags");
    expect(json.dupes).toEqual([]);
    expect(deps.findDupesForUser).toHaveBeenCalledWith(
      {},
      "user-1",
      expect.objectContaining({ imageUrl: VALID_INPUT.imageUrl }),
    );
  });

  test("nothing close enough -> 200 with matchQuality 'none' and the message, for mobile", async () => {
    const deps = fakeDeps({
      findDupesForUser: mock(async () => ({
        inspiration: {
          ...INSPIRATION,
          category: "Outerwear" as const,
          garment_type: "coat" as const,
        },
        dupes: [],
        matchQuality: "none" as const,
        message: "Nothing in our catalogue is close enough to this coat yet.",
      })),
    });

    const res = await handleDupesFind(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.dupes).toEqual([]);
    expect(json.matchQuality).toBe("none");
    expect(json.message).toBe("Nothing in our catalogue is close enough to this coat yet.");
    expect(json.inspiration.garment_type).toBe("coat");
  });

  test("insufficient credits -> 402 INSUFFICIENT_CREDITS", async () => {
    const deps = fakeDeps({
      findDupesForUser: mock(async () => {
        throw new InsufficientCreditsError();
      }),
    });

    const res = await handleDupesFind(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(402);
    expect(json.error.code).toBe("INSUFFICIENT_CREDITS");
  });

  test("clientRequestId gives inFlight report and passes { status: running, jobId } through", async () => {
    const clientRequestId = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
    const deps = fakeDeps({
      findDupesForUser: mock(async () => ({ status: "running", jobId: "job-9" })) as never,
    });

    const res = await handleDupesFind(
      postRequest({ ...VALID_INPUT, clientRequestId }, "good-token"),
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "running", jobId: "job-9" });
    const call = (deps.findDupesForUser as ReturnType<typeof mock>).mock.calls[0];
    expect(call[2]).toMatchObject({ clientRequestId, imageUrl: VALID_INPUT.imageUrl });
    // The service's own deps stay the production ones.
    expect(call[3]).toBeUndefined();
    expect(call[4]).toEqual({ inFlight: "report" });
  });

  test("a refunded hunt answers creditRefunded and its jobId, for mobile", async () => {
    const clientRequestId = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
    const deps = fakeDeps({
      findDupesForUser: mock(async () => ({
        inspiration: INSPIRATION,
        dupes: [],
        matchQuality: "none" as const,
        message: "Nothing in our catalogue is close enough to this bag yet.",
        creditRefunded: true,
        jobId: "job-9",
      })) as never,
    });

    const res = await handleDupesFind(
      postRequest({ ...VALID_INPUT, clientRequestId }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.creditRefunded).toBe(true);
    expect(json.jobId).toBe("job-9");
  });

  test("without clientRequestId the call is today's three arguments, so it waits for the hunt", async () => {
    const deps = fakeDeps();

    const res = await handleDupesFind(postRequest(VALID_INPUT, "good-token"), deps);

    expect(res.status).toBe(200);
    const call = (deps.findDupesForUser as ReturnType<typeof mock>).mock.calls[0];
    expect(call).toHaveLength(3);
    expect(call[2]).not.toHaveProperty("clientRequestId");
  });

  test("a malformed clientRequestId -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();

    const res = await handleDupesFind(
      postRequest({ ...VALID_INPUT, clientRequestId: "nope" }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.findDupesForUser).not.toHaveBeenCalled();
  });

  test("invalid body -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();

    const res = await handleDupesFind(postRequest({ imageUrl: "not-a-url" }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.findDupesForUser).not.toHaveBeenCalled();
  });
});
