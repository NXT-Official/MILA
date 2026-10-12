import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { memberQueryRetry } from "./member-query";
import { profileQueryOptions } from "./profile";
import {
  PROFILE_EXTRAS_COLUMNS,
  PROFILE_EXTRAS_WRITABLE,
  profileExtrasQueryOptions,
  saveProfileExtras,
  type ProfileExtrasState,
} from "./profile-extras";
import { fakeMemberSession } from "../../../tests/helpers/fake-member-supabase";

const USER = "user-1";
const TOKEN = "member-token";
const WAVE_D_COLUMNS = [
  "hair_color",
  "last_check_in_at",
  "founding_body_read_at",
  "free_check_in_on",
];

/** The column names in a PostgREST select string, trimmed. */
function selectedColumns(select: string): string[] {
  return select
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

type Result = {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
};

/** Records every builder call and answers the awaited chain with `result`. */
function fakeClient(result: Result, session = fakeMemberSession(USER, TOKEN)) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "update", "eq", "maybeSingle", "setHeader"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
      count: result.count ?? null,
    }).then(resolve, reject);
  const client = {
    auth: { getSession: async () => ({ data: { session }, error: null }) },
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    },
  };
  return { client: client as never, calls };
}

async function fetchExtras(client: never): Promise<ProfileExtrasState> {
  const queryClient = new QueryClient();
  const state = await queryClient.fetchQuery({
    ...profileExtrasQueryOptions(USER, client),
    retry: false,
  });
  queryClient.clear();
  return state;
}

describe("profileExtrasQueryOptions", () => {
  test("reads her Wave D columns as her, with the member retry policy", async () => {
    const { client, calls } = fakeClient({
      data: {
        hair_color: "Auburn",
        last_check_in_at: "2026-10-07T08:00:00.123456+00:00",
        founding_body_read_at: null,
      },
    });
    const options = profileExtrasQueryOptions(USER, client);
    expect(options.queryKey).toEqual(queryKeys.profileExtras(USER));
    expect(options.retry).toBe(memberQueryRetry);

    expect(await fetchExtras(client)).toEqual({
      available: true,
      hairColor: "Auburn",
      lastCheckInAt: "2026-10-07T08:00:00.123456+00:00",
      foundingBodyReadAt: null,
    });
    expect(calls[0]).toEqual(["from", "profiles"]);
    expect(calls).toContainEqual(["select", PROFILE_EXTRAS_COLUMNS]);
    expect(PROFILE_EXTRAS_COLUMNS).toBe("hair_color,last_check_in_at,founding_body_read_at");
    expect(calls).toContainEqual(["eq", "id", USER]);
    expect(calls).toContainEqual(["setHeader", "Authorization", `Bearer ${TOKEN}`]);
  });

  test("keeps hair_color only when it is one of HAIR_COLORS", async () => {
    const { client } = fakeClient({ data: { hair_color: "blue-ish", last_check_in_at: null } });
    expect((await fetchExtras(client)).hairColor).toBeNull();
  });

  test("a missing column or table reads as unavailable, never an error", async () => {
    for (const code of ["42703", "PGRST204", "PGRST205", "42P01"]) {
      const { client } = fakeClient({ error: { code, message: "missing" } });
      expect(await fetchExtras(client)).toEqual({
        available: false,
        hairColor: null,
        lastCheckInAt: null,
        foundingBodyReadAt: null,
      });
    }
  });

  test("a read that finds no row reads as unavailable, never an unused founding scan", async () => {
    const { client } = fakeClient({ data: null });
    expect(await fetchExtras(client)).toEqual({
      available: false,
      hairColor: null,
      lastCheckInAt: null,
      foundingBodyReadAt: null,
    });
  });

  test("any other failure throws, so React Query keeps her last good answer", async () => {
    const { client } = fakeClient({ error: { code: "PGRST301", message: "JWT expired" } });
    await expect(fetchExtras(client)).rejects.toMatchObject({ code: "PGRST301" });
  });
});

describe("saveProfileExtras", () => {
  test("sends only allowed columns in one update and invalidates profile and profileExtras", async () => {
    expect([...PROFILE_EXTRAS_WRITABLE].sort()).toEqual(
      ["body_type", "hair_color", "hair_length", "last_check_in_at", "skin_depth"].sort(),
    );
    const { client, calls } = fakeClient({ count: 1 });
    const queryClient = new QueryClient();
    const invalidate = spyOn(queryClient, "invalidateQueries");

    const outcome = await saveProfileExtras(
      USER,
      {
        hair_color: "Ash blonde",
        last_check_in_at: "2026-10-07T09:00:00.000Z",
        skin_depth: "Light",
        hair_length: "Long",
        body_type: "Pear",
        // Not allowed: never sent, whatever a caller spreads in.
        ...({
          color_season: "Winter",
          founding_body_read_at: "2026-10-07T09:00:00.000Z",
          free_check_in_on: "2026-10-07",
          id: "someone-else",
        } as object),
      },
      { queryClient, client },
    );

    expect(outcome).toBe("saved");
    const updates = calls.filter(([method]) => method === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toEqual({
      hair_color: "Ash blonde",
      last_check_in_at: "2026-10-07T09:00:00.000Z",
      skin_depth: "Light",
      hair_length: "Long",
      body_type: "Pear",
    });
    expect(updates[0][2]).toEqual({ count: "exact" });
    expect(calls).toContainEqual(["from", "profiles"]);
    expect(calls).toContainEqual(["eq", "id", USER]);
    expect(calls).toContainEqual(["setHeader", "Authorization", `Bearer ${TOKEN}`]);

    const keys = invalidate.mock.calls.map(
      ([filters]) => (filters as { queryKey: unknown }).queryKey,
    );
    expect(keys).toContainEqual(queryKeys.profile(USER));
    expect(keys).toContainEqual(queryKeys.profileExtras(USER));
  });

  test("sends a null to clear a field", async () => {
    const { client, calls } = fakeClient({ count: 1 });
    await saveProfileExtras(USER, { hair_color: null }, { queryClient: new QueryClient(), client });
    expect(calls.find(([method]) => method === "update")?.[1]).toEqual({ hair_color: null });
  });

  test("a write that changed no row is not a save", async () => {
    const { client } = fakeClient({ count: 0 });
    expect(
      await saveProfileExtras(
        USER,
        { skin_depth: "Deep" },
        { queryClient: new QueryClient(), client },
      ),
    ).toBe("not_saved");
  });

  test("a missing Wave D column reads as unavailable", async () => {
    for (const code of ["42703", "PGRST204"]) {
      const { client } = fakeClient({ error: { code, message: "missing" } });
      expect(
        await saveProfileExtras(
          USER,
          { hair_color: "Black" },
          { queryClient: new QueryClient(), client },
        ),
      ).toBe("unavailable");
    }
  });

  test("any other failure throws", async () => {
    const { client } = fakeClient({ error: { code: "42501", message: "permission denied" } });
    await expect(
      saveProfileExtras(USER, { hair_color: "Black" }, { queryClient: new QueryClient(), client }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  test("refuses a hair colour outside HAIR_COLORS, or nothing to save, before any request", async () => {
    const { client, calls } = fakeClient({ count: 1 });
    await expect(
      saveProfileExtras(
        USER,
        { hair_color: "Blue" as never },
        { queryClient: new QueryClient(), client },
      ),
    ).rejects.toThrow();
    await expect(
      saveProfileExtras(
        USER,
        { ...({ color_season: "Winter" } as object) },
        {
          queryClient: new QueryClient(),
          client,
        },
      ),
    ).rejects.toThrow();
    expect(calls.filter(([method]) => method === "update")).toHaveLength(0);
  });
});

describe("profile read guard", () => {
  test("profileQueryOptions never selects a Wave D column", async () => {
    const { client, calls } = fakeClient({ data: null });
    const queryClient = new QueryClient();
    await queryClient.fetchQuery({ ...profileQueryOptions(USER, client), retry: false });
    queryClient.clear();
    const select = calls.find(([method]) => method === "select")?.[1];
    expect(typeof select).toBe("string");
    const columns = selectedColumns(select as string);
    expect(columns.length).toBeGreaterThan(0);
    for (const column of WAVE_D_COLUMNS) expect(columns).not.toContain(column);
  });

  test("the look service's profile reads never select a Wave D column", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "server", "services", "look.ts"),
      "utf8",
    );
    const selects = [...source.matchAll(/\.from\("profiles"\)\s*\.select\(\s*"([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      for (const column of WAVE_D_COLUMNS) expect(selectedColumns(select)).not.toContain(column);
    }
  });

  test("the guard reads a column however it is spaced", () => {
    expect(selectedColumns("gender, hair_color ,\n  last_check_in_at")).toEqual([
      "gender",
      "hair_color",
      "last_check_in_at",
    ]);
  });
});
