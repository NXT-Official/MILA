import { describe, expect, spyOn, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createAvailabilityCache } from "@/lib/availability-cache";
import { checkInAvailability, freeCheckInSlot } from "./free-check-in-slot.server";

/**
 * The free daily check-in slot through the REAL supabase-js client (the
 * installed 2.110.0) with only `fetch` stubbed, so the exact PostgREST request
 * (method, filters, body) is what is asserted.
 */

const URL_BASE = "http://stub.supabase.test";
const USER = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
const TODAY = "2026-10-07";

type Recorded = { method: string; url: URL; body: unknown };
type Reply = { status: number; body: unknown };

function stubClient(answer: (req: Recorded) => Reply) {
  const requests: Recorded[] = [];
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const raw = await request.text();
    const recorded = {
      method: request.method,
      url: new URL(request.url),
      body: raw ? JSON.parse(raw) : null,
    };
    requests.push(recorded);
    const reply = answer(recorded);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient<Database>(URL_BASE, "service-role-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub as typeof fetch },
  });
  return { admin: async () => client, requests };
}

const missingColumn = (): Reply => ({
  status: 400,
  body: {
    code: "42703",
    details: null,
    hint: null,
    message: "column user_entitlements.free_check_in_on does not exist",
  },
});

describe("freeCheckInSlot", () => {
  test("claim marks today only where today's free check-in is still unclaimed", async () => {
    const { admin, requests } = stubClient(() => ({ status: 200, body: [{ user_id: USER }] }));

    expect(await freeCheckInSlot(USER, TODAY, admin).claim()).toBe(true);

    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe("PATCH");
    expect(req.url.pathname).toBe("/rest/v1/user_entitlements");
    expect(req.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
    expect(req.url.searchParams.get("or")).toBe(
      `(free_check_in_on.is.null,free_check_in_on.lt.${TODAY})`,
    );
    expect(req.url.searchParams.get("select")).toBe("user_id");
    expect(req.body).toEqual({ free_check_in_on: TODAY });
  });

  test("claim answers false when nothing matched: today's free check-in is already used", async () => {
    const { admin } = stubClient(() => ({ status: 200, body: [] }));
    expect(await freeCheckInSlot(USER, TODAY, admin).claim()).toBe(false);
  });

  test("release hands back only today's claim", async () => {
    // The claim asks for its row back (`select`); the release does not.
    const { admin, requests } = stubClient((req) =>
      req.url.searchParams.has("select")
        ? { status: 200, body: [{ user_id: USER }] }
        : { status: 204, body: null },
    );
    const slot = freeCheckInSlot(USER, TODAY, admin);

    expect(await slot.claim()).toBe(true);
    await slot.release();

    expect(requests).toHaveLength(2);
    const req = requests[1];
    expect(req.method).toBe("PATCH");
    expect(req.url.pathname).toBe("/rest/v1/user_entitlements");
    expect(req.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
    expect(req.url.searchParams.get("free_check_in_on")).toBe(`eq.${TODAY}`);
    expect(req.body).toEqual({ free_check_in_on: null });
  });

  test("only the request that won the claim gives it back, and only once", async () => {
    const lost = stubClient(() => ({ status: 200, body: [] }));
    const losing = freeCheckInSlot(USER, TODAY, lost.admin);
    expect(await losing.claim()).toBe(false);
    await losing.release();
    // Another request's claim is never handed back by this one.
    expect(lost.requests).toHaveLength(1);

    const won = stubClient((req) =>
      req.url.searchParams.has("select")
        ? { status: 200, body: [{ user_id: USER }] }
        : { status: 204, body: null },
    );
    const winning = freeCheckInSlot(USER, TODAY, won.admin);
    expect(await winning.claim()).toBe(true);
    await winning.release();
    await winning.release();
    expect(won.requests.map((r) => r.url.searchParams.has("select"))).toEqual([true, false]);

    const never = stubClient(() => ({ status: 204, body: null }));
    await freeCheckInSlot(USER, TODAY, never.admin).release();
    expect(never.requests).toHaveLength(0);
  });

  test("a failed claim or release throws without the database's text, never a free guess", async () => {
    const failure = {
      status: 500,
      body: { code: "XX000", details: null, hint: null, message: "secret internals" },
    };
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const failedClaim = stubClient(() => failure);
      const claim = await freeCheckInSlot(USER, TODAY, failedClaim.admin)
        .claim()
        .then(
          () => null,
          (err: unknown) => err,
        );
      expect(claim).toBeInstanceOf(Error);
      expect(String((claim as Error).message)).not.toContain("secret internals");

      const failedRelease = stubClient((req) =>
        req.url.searchParams.has("select") ? { status: 200, body: [{ user_id: USER }] } : failure,
      );
      const slot = freeCheckInSlot(USER, TODAY, failedRelease.admin);
      expect(await slot.claim()).toBe(true);
      const release = await slot.release().then(
        () => null,
        (err: unknown) => err,
      );
      expect(release).toBeInstanceOf(Error);
      expect(String((release as Error).message)).not.toContain("secret internals");
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("a malformed day is refused before any request", async () => {
    const { admin, requests } = stubClient(() => ({ status: 200, body: [] }));
    expect(() => freeCheckInSlot(USER, "2026-10-07,free_check_in_on.gt.0", admin)).toThrow();
    expect(requests).toHaveLength(0);
  });
});

describe("checkInAvailability", () => {
  test("available once free_check_in_on answers", async () => {
    const { admin, requests } = stubClient(() => ({ status: 200, body: [] }));
    const cache = createAvailabilityCache(60_000);

    expect(await checkInAvailability({ admin, cache })).toBe(true);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].url.pathname).toBe("/rest/v1/user_entitlements");
    expect(requests[0].url.searchParams.get("select")).toBe("free_check_in_on");
  });

  test("a missing column answers false and is remembered, so the next call asks nothing", async () => {
    const { admin, requests } = stubClient(missingColumn);
    const cache = createAvailabilityCache(60_000);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await checkInAvailability({ admin, cache })).toBe(false);
      expect(await checkInAvailability({ admin, cache })).toBe(false);
      expect(requests).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  test("any other failure answers false without remembering it", async () => {
    let calls = 0;
    const { admin } = stubClient(() => {
      calls += 1;
      // 500, not 503: supabase-js retries a GET that answers 503 on its own.
      return calls === 1
        ? { status: 500, body: { code: "XX000", details: null, hint: null, message: "down" } }
        : { status: 200, body: [] };
    });
    const cache = createAvailabilityCache(60_000);
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await checkInAvailability({ admin, cache })).toBe(false);
      expect(await checkInAvailability({ admin, cache })).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
