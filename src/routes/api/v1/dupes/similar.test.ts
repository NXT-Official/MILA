import { describe, expect, mock, test } from "bun:test";
import { handleDupesSimilar, type HandleDupesSimilarDeps } from "./similar";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";

const VALID_INPUT = {
  attributes: {
    name: "Quilted vanity case",
    category: "Accessories",
    primary_color: "Cream",
    color_undertone: "Warm",
    silhouette_tags: ["quilted", "top-handle"],
  },
  maxResults: 4,
};

function fakeDeps(overrides: Partial<HandleDupesSimilarDeps> = {}): HandleDupesSimilarDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    findSimilarItemsForUser: mock(async () => [
      {
        id: "prod-1",
        title: "Cream quilted bag",
        brand_id: "brand-1",
        category: "Accessories",
        price: 4200,
        currency: "usd",
        image_url: null,
        affiliate_link: "https://example.com/prod-1",
        description: null,
        match_score: 55,
        match_reasons: ["Same category (Bags)"],
        verification_status: "verified",
        last_verified_at: null,
        rating: null,
        units_sold: null,
        shipping_info: null,
        discount_percent: null,
        is_verified_seller: true,
      },
    ]),
    ...overrides,
  } as HandleDupesSimilarDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/dupes/similar", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/dupes/similar", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleDupesSimilar(postRequest(VALID_INPUT), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with ranked matches", async () => {
    const deps = fakeDeps();
    const res = await handleDupesSimilar(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveLength(1);
    expect(json[0].title).toBe("Cream quilted bag");
  });

  test("missing attributes -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handleDupesSimilar(postRequest({ maxResults: 4 }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.findSimilarItemsForUser).not.toHaveBeenCalled();
  });
});
