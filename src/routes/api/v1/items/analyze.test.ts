import { describe, expect, mock, test } from "bun:test";
import { handleItemsAnalyze, type HandleItemsAnalyzeDeps } from "./analyze";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";

const POST_ID = "11111111-1111-1111-1111-111111111111";

function fakeDeps(overrides: Partial<HandleItemsAnalyzeDeps> = {}): HandleItemsAnalyzeDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    analyzeOutfitItemsForUser: mock(async () => [
      {
        id: "item-1",
        label: "Black cropped blazer",
        category: "Outerwear",
        attributes: {
          name: "Black cropped blazer",
          category: "Outerwear",
          primary_color: "Black",
          color_undertone: "Neutral",
          silhouette_tags: ["cropped", "structured"],
        },
        bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
        source_url: null,
      },
    ]),
    ...overrides,
  } as HandleItemsAnalyzeDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/items/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/items/analyze", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleItemsAnalyze(postRequest({ post_id: POST_ID }), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with detected items", async () => {
    const deps = fakeDeps();
    const res = await handleItemsAnalyze(postRequest({ post_id: POST_ID }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveLength(1);
    expect(json[0].label).toBe("Black cropped blazer");
  });

  test("nothing detected -> 200 with an empty array", async () => {
    const deps = fakeDeps({ analyzeOutfitItemsForUser: mock(async () => []) });
    const res = await handleItemsAnalyze(postRequest({ post_id: POST_ID }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([]);
  });

  test("with clientRequestId -> asks to be told when a detection is running", async () => {
    const running = { status: "running", jobId: "job-1" };
    const analyze = mock(async () => running);
    const deps = fakeDeps({ analyzeOutfitItemsForUser: analyze as never });
    const clientRequestId = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
    const res = await handleItemsAnalyze(
      postRequest({ post_id: POST_ID, clientRequestId }, "good-token"),
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(running);
    expect(analyze.mock.calls[0]).toEqual([
      expect.anything(),
      "user-1",
      { post_id: POST_ID, clientRequestId },
      { inFlight: "report" },
    ]);
  });

  test("without clientRequestId -> old shape, waits for an in-flight run", async () => {
    const analyze = mock(async () => []);
    const deps = fakeDeps({ analyzeOutfitItemsForUser: analyze as never });
    const res = await handleItemsAnalyze(postRequest({ post_id: POST_ID }, "good-token"), deps);

    expect(res.status).toBe(200);
    expect(analyze.mock.calls[0]).toHaveLength(3);
  });

  test("a clientRequestId that is not a uuid -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handleItemsAnalyze(
      postRequest({ post_id: POST_ID, clientRequestId: "nope" }, "good-token"),
      deps,
    );
    expect(res.status).toBe(400);
    expect(deps.analyzeOutfitItemsForUser).not.toHaveBeenCalled();
  });

  test("missing post_id -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handleItemsAnalyze(postRequest({}, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.analyzeOutfitItemsForUser).not.toHaveBeenCalled();
  });
});
