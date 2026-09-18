import { describe, expect, mock, test } from "bun:test";
import { handleProfileMember, type HandleProfileMemberDeps } from "./member";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";

const USER_ID = "11111111-1111-1111-1111-111111111111";

function fakeDeps(overrides: Partial<HandleProfileMemberDeps> = {}): HandleProfileMemberDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    getMemberProfileForUser: mock(async () => ({
      profile: {
        id: USER_ID,
        full_name: "Ava Stone",
        username: "ava",
        color_season: "Bright Winter",
        face_shape: "Oval",
        hair_type: "Wavy",
        created_at: "2026-01-01T00:00:00.000Z",
        verified: true,
      },
      posts: [],
      can_view_hidden: false,
    })),
    ...overrides,
  } as HandleProfileMemberDeps;
}

function getRequest(userId: string | null, token?: string) {
  const url = new URL("https://mila.test/api/v1/profile/member");
  if (userId !== null) url.searchParams.set("user_id", userId);
  return new Request(url, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("GET /api/v1/profile/member", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleProfileMember(getRequest(USER_ID), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 with the member profile", async () => {
    const deps = fakeDeps();
    const res = await handleProfileMember(getRequest(USER_ID, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.profile.username).toBe("ava");
    expect(json.can_view_hidden).toBe(false);
  });

  test("missing user_id -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handleProfileMember(getRequest(null, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.getMemberProfileForUser).not.toHaveBeenCalled();
  });
});
