import { describe, expect, mock, test } from "bun:test";
import { handleAccountDelete, type HandleAccountDeleteDeps } from "./delete";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";

function fakeDeps(overrides: Partial<HandleAccountDeleteDeps> = {}): HandleAccountDeleteDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: {} as never,
      userId: "user-1",
      claims: {} as never,
    })),
    deleteAccountForApiUser: mock(async () => ({ success: true as const })),
    ...overrides,
  } as HandleAccountDeleteDeps;
}

function postRequest(body: unknown, token?: string) {
  return new Request("https://mila.test/api/v1/account/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/account/delete", () => {
  test("no token -> 401 UNAUTHENTICATED", async () => {
    const deps = fakeDeps({
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
    });

    const res = await handleAccountDelete(postRequest({ email: "member@example.com" }), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("happy path -> 200 success", async () => {
    const deps = fakeDeps();
    const res = await handleAccountDelete(
      postRequest({ email: "member@example.com" }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  test("mismatched confirmation email -> 400 VALIDATION_FAILED", async () => {
    const { DomainValidationError } = await import("@/server/http/api-errors");
    const deps = fakeDeps({
      deleteAccountForApiUser: mock(async () => {
        throw new DomainValidationError(
          "That email doesn't match the account you're signed in to.",
        );
      }),
    });

    const res = await handleAccountDelete(
      postRequest({ email: "someone@else.com" }, "good-token"),
      deps,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(json.error.message).toContain("doesn't match");
  });

  test("missing email -> 400 VALIDATION_FAILED", async () => {
    const deps = fakeDeps();
    const res = await handleAccountDelete(postRequest({}, "good-token"), deps);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(deps.deleteAccountForApiUser).not.toHaveBeenCalled();
  });
});
