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

  test("invalid body -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();

    const res = await handleDupesFind(postRequest({ imageUrl: "not-a-url" }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.findDupesForUser).not.toHaveBeenCalled();
  });
});
