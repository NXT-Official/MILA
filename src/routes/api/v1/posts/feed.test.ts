import { describe, expect, mock, test } from "bun:test";
import { handlePostsFeed, type HandlePostsFeedDeps } from "./feed";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";

function fakeDeps(overrides: Partial<HandlePostsFeedDeps> = {}): HandlePostsFeedDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    getFeedForUser: mock(async () => ({ has_posted_today: true, posts: [] })),
    ...overrides,
  } as HandlePostsFeedDeps;
}

function getRequest(token?: string) {
  return new Request("https://mila.test/api/v1/posts/feed", {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("GET /api/v1/posts/feed", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handlePostsFeed(getRequest(), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the feed", async () => {
    const deps = fakeDeps();
    const res = await handlePostsFeed(getRequest("good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.has_posted_today).toBe(true);
    expect(json.posts).toEqual([]);
  });

  test("an unexpected failure -> 500 INTERNAL, no internals leaked", async () => {
    const deps = fakeDeps({
      getFeedForUser: mock(async () => {
        throw new Error("relation posts does not exist");
      }),
    });

    const res = await handlePostsFeed(getRequest("good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error.code).toBe("INTERNAL");
    expect(json.error.message).not.toContain("relation");
  });
});
