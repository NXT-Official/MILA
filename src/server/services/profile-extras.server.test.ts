import { describe, expect, spyOn, test } from "bun:test";
import { readProfileExtras } from "./profile-extras.server";

const USER = "00000000-0000-4000-8000-0000000000aa";

type Result = { data?: unknown; error?: { code?: string; message: string } | null };

/** Records every builder call and answers the awaited chain with `result`. */
function fakeClient(result: Result | (() => never)) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
    if (typeof result === "function")
      return Promise.reject(new Error("network down")).then(resolve, reject);
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(
      resolve,
      reject,
    );
  };
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    },
  };
  return { client: client as never, calls };
}

const UNAVAILABLE = {
  available: false,
  hairColor: null,
  lastCheckInAt: null,
  foundingBodyReadAt: null,
};

describe("readProfileExtras", () => {
  test("reads her three Wave D columns by id", async () => {
    const { client, calls } = fakeClient({
      data: {
        hair_color: "Grey or silver",
        last_check_in_at: "2026-10-07T08:00:00.123456+00:00",
        founding_body_read_at: "2026-10-01T10:00:00+00:00",
      },
    });
    expect(await readProfileExtras(client, USER)).toEqual({
      available: true,
      hairColor: "Grey or silver",
      lastCheckInAt: "2026-10-07T08:00:00.123456+00:00",
      foundingBodyReadAt: "2026-10-01T10:00:00+00:00",
    });
    expect(calls[0]).toEqual(["from", "profiles"]);
    expect(calls).toContainEqual(["select", "hair_color,last_check_in_at,founding_body_read_at"]);
    expect(calls).toContainEqual(["eq", "id", USER]);
  });

  test("answers available false on 42703, PGRST204, PGRST205 and 42P01 and never throws", async () => {
    for (const code of ["42703", "PGRST204", "PGRST205", "42P01"]) {
      const { client } = fakeClient({ error: { code, message: "missing" } });
      expect(await readProfileExtras(client, USER)).toMatchObject({
        ...UNAVAILABLE,
        reason: "missing",
      });
    }
  });

  test("any other failure fails closed, logs without her id, and never throws", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const refused = fakeClient({ error: { code: "PGRST301", message: `bad jwt for ${USER}` } });
      expect(await readProfileExtras(refused.client, USER)).toMatchObject({
        ...UNAVAILABLE,
        reason: "error",
      });
      const offline = fakeClient(() => {
        throw new Error("unreachable");
      });
      expect(await readProfileExtras(offline.client, USER)).toMatchObject({
        ...UNAVAILABLE,
        reason: "error",
      });
      const exploding = {
        from: () => {
          throw new Error("client broke");
        },
      } as never;
      expect(await readProfileExtras(exploding, USER)).toMatchObject({
        ...UNAVAILABLE,
        reason: "error",
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain(USER);
    } finally {
      logged.mockRestore();
    }
  });

  test("a read that finds no row fails closed: never available with an unused founding scan", async () => {
    const warned = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { client } = fakeClient({ data: null });
      expect(await readProfileExtras(client, USER)).toEqual({
        ...UNAVAILABLE,
        reason: "missing_row",
      });
      expect(JSON.stringify(warned.mock.calls)).not.toContain(USER);
    } finally {
      warned.mockRestore();
    }
  });

  test("keeps hair_color only when it is one of HAIR_COLORS", async () => {
    for (const stored of ["blue", "black", "Black ", "", 7, ["Black"]]) {
      const { client } = fakeClient({ data: { hair_color: stored } });
      expect((await readProfileExtras(client, USER)).hairColor).toBeNull();
    }
    const { client } = fakeClient({ data: { hair_color: "Vivid dyed shade" } });
    expect((await readProfileExtras(client, USER)).hairColor).toBe("Vivid dyed shade");
  });

  test("a non-text timestamp reads as null", async () => {
    const { client } = fakeClient({
      data: { hair_color: null, last_check_in_at: 12, founding_body_read_at: "" },
    });
    expect(await readProfileExtras(client, USER)).toEqual({
      available: true,
      hairColor: null,
      lastCheckInAt: null,
      foundingBodyReadAt: null,
    });
  });
});
