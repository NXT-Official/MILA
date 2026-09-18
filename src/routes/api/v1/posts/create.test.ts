import { describe, expect, mock, test } from "bun:test";
import { handlePostsCreate, type HandlePostsCreateDeps } from "./create";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";

const VALID_INPUT = {
  image_path_back: "user-1/back.jpg",
  image_path_front: "user-1/front.jpg",
  caption: "Rooftop dinner",
};

function fakeDeps(overrides: Partial<HandlePostsCreateDeps> = {}): HandlePostsCreateDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    createPostForUser: mock(async () => ({ id: "post-1" })),
    ...overrides,
  } as HandlePostsCreateDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/posts/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/posts/create", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handlePostsCreate(postRequest(VALID_INPUT), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the new post id", async () => {
    const deps = fakeDeps();
    const res = await handlePostsCreate(postRequest(VALID_INPUT, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe("post-1");
  });

  test("missing image paths -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handlePostsCreate(postRequest({ caption: "hi" }, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.createPostForUser).not.toHaveBeenCalled();
  });
});
