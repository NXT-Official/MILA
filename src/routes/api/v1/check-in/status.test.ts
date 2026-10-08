import { describe, expect, mock, test } from "bun:test";
import { UnauthorizedError } from "@/integrations/supabase/auth-middleware";
import { getCheckInStatusForUser } from "@/server/services/check-in";
import { handleCheckInStatus, type HandleCheckInStatusDeps } from "./status";

const USER = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
const NOON = Date.parse("2026-10-07T12:00:00.000Z");

type TableResult = { data?: unknown; error?: { code: string; message: string } };

/** Her own client, answering one read per table, as PostgREST would. */
function memberClient(tables: Record<string, TableResult>) {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: tables[table]?.data ?? null,
          error: tables[table]?.error ?? null,
        }),
      };
      return chain;
    },
  } as never;
}

function depsFor(supabase: unknown): HandleCheckInStatusDeps {
  return {
    verifyBearerAuth: mock(async () => ({
      supabase: supabase as never,
      userId: USER,
      claims: {} as never,
    })),
    // The real service, on a fixed clock.
    getCheckInStatusForUser: (client, userId) =>
      getCheckInStatusForUser(client, userId, { now: () => NOON }),
  };
}

const getRequest = (token?: string) =>
  new Request("https://mila.test/api/v1/check-in/status", {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

describe("GET /api/v1/check-in/status", () => {
  test("401 without a bearer token", async () => {
    const res = await handleCheckInStatus(getRequest(), {
      verifyBearerAuth: mock(async () => {
        throw new UnauthorizedError("Unauthorized: No authorization header provided");
      }),
      getCheckInStatusForUser: mock(async () => {
        throw new Error("must not run");
      }),
    });

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("reports free today, cost and body scan availability", async () => {
    const res = await handleCheckInStatus(
      getRequest("good-token"),
      depsFor(
        memberClient({
          user_entitlements: { data: { free_check_in_on: "2026-10-06" } },
          profiles: {
            data: { hair_color: null, last_check_in_at: null, founding_body_read_at: null },
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      available: true,
      freeToday: true,
      checkInCost: 0,
      bodyScan: { available: true, free: true, cost: 0 },
    });
  });

  test("today's free check-in used and the founding scan spent: both cost one credit", async () => {
    const res = await handleCheckInStatus(
      getRequest("good-token"),
      depsFor(
        memberClient({
          user_entitlements: { data: { free_check_in_on: "2026-10-07" } },
          profiles: {
            data: {
              hair_color: "Black",
              last_check_in_at: "2026-10-07T08:00:00+00:00",
              founding_body_read_at: "2026-10-02T08:00:00+00:00",
            },
          },
        }),
      ),
    );

    expect(await res.json()).toEqual({
      available: true,
      freeToday: false,
      checkInCost: 1,
      bodyScan: { available: true, free: false, cost: 1 },
    });
  });

  test("unavailable when the migration is missing", async () => {
    const missing = { code: "42703", message: "column does not exist" };
    const res = await handleCheckInStatus(
      getRequest("good-token"),
      depsFor(
        memberClient({ user_entitlements: { error: missing }, profiles: { error: missing } }),
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      available: false,
      freeToday: false,
      checkInCost: 1,
      bodyScan: { available: false, free: false, cost: 1 },
    });
  });
});
