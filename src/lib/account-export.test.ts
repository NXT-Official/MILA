import { describe, expect, spyOn, test } from "bun:test";
import {
  buildAccountExport,
  fetchAccountExport,
  isMissingTableError,
  type ExportClient,
  type QueryOutcome,
} from "./account-export";

const OK = (data: unknown): QueryOutcome => ({ data, error: null });
const FAIL = (code: string): QueryOutcome => ({
  data: null,
  error: { code, message: "raw db text" },
});

const ACCOUNT = { id: "user-1", email: "jane.doe@example.com" };
const EXPORTED_AT = "2026-10-07T00:00:00.000Z";

function build(overrides: Partial<Parameters<typeof buildAccountExport>[0]> = {}) {
  return buildAccountExport({
    exportedAt: EXPORTED_AT,
    account: ACCOUNT,
    profile: OK({ id: "user-1" }),
    outfits: OK([{ id: "o1" }]),
    posts: OK([{ id: "p1" }]),
    favorites: OK([{ id: "f1" }]),
    savedProducts: OK([{ id: "s1" }]),
    ...overrides,
  });
}

describe("isMissingTableError", () => {
  test("recognises PostgREST and Postgres missing-relation codes", () => {
    expect(isMissingTableError({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isMissingTableError({ code: "42P01", message: "x" })).toBe(true);
  });

  test("does not treat other failures as a missing table", () => {
    expect(isMissingTableError({ code: "42501", message: "x" })).toBe(false);
    expect(isMissingTableError({ code: "PGRST301", message: "x" })).toBe(false);
    expect(isMissingTableError({ message: "network" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe("buildAccountExport", () => {
  test("includes every section, saved pieces included", () => {
    const out = build();
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.payload).toEqual({
      exportedAt: EXPORTED_AT,
      account: ACCOUNT,
      profile: { id: "user-1" },
      outfits: [{ id: "o1" }],
      posts: [{ id: "p1" }],
      favorites: [{ id: "f1" }],
      savedProducts: [{ id: "s1" }],
    });
  });

  test("skips saved pieces silently while their table is not there yet", () => {
    for (const code of ["PGRST205", "42P01"]) {
      const out = build({ savedProducts: FAIL(code) });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect("savedProducts" in out.payload).toBe(false);
      expect(out.payload.outfits).toEqual([{ id: "o1" }]);
    }
  });

  test("refuses to hand over a partial file when saved pieces fail for another reason", () => {
    expect(build({ savedProducts: FAIL("57014") }).ok).toBe(false);
  });

  test("refuses to hand over a partial file when a core table fails", () => {
    expect(build({ outfits: FAIL("57014") }).ok).toBe(false);
    expect(build({ posts: FAIL("42501") }).ok).toBe(false);
    expect(build({ favorites: FAIL("PGRST301") }).ok).toBe(false);
    expect(build({ profile: FAIL("42501") }).ok).toBe(false);
  });

  test("a core table that is missing is a failure, not a silent skip", () => {
    expect(build({ outfits: FAIL("PGRST205") }).ok).toBe(false);
  });

  test("empty results become empty lists and a missing profile stays null", () => {
    const out = build({
      profile: OK(null),
      outfits: OK(null),
      posts: OK(null),
      favorites: OK(null),
      savedProducts: OK(null),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.payload.profile).toBeNull();
    expect(out.payload.outfits).toEqual([]);
    expect(out.payload.savedProducts).toEqual([]);
  });
});

type Call = { table: string; columns: string; column: string; value: string };

function fakeClient(results: Record<string, QueryOutcome>, calls: Call[]): ExportClient {
  return {
    from(table) {
      return {
        select(columns) {
          return {
            eq(column, value) {
              calls.push({ table, columns, column, value });
              const outcome = results[table] ?? OK([]);
              return {
                maybeSingle: () => Promise.resolve(outcome),
                then: (onfulfilled, onrejected) =>
                  Promise.resolve(outcome).then(onfulfilled, onrejected),
              };
            },
          };
        },
      };
    },
  };
}

describe("fetchAccountExport", () => {
  test("reads each table scoped to the signed-in member, saved pieces included", async () => {
    const calls: Call[] = [];
    const out = await fetchAccountExport(
      ACCOUNT,
      fakeClient({ profiles: OK({ id: "user-1" }), saved_products: OK([{ id: "s1" }]) }, calls),
      EXPORTED_AT,
    );
    expect(out.ok).toBe(true);
    expect(calls).toEqual([
      { table: "profiles", columns: "*", column: "id", value: "user-1" },
      { table: "outfits", columns: "*", column: "user_id", value: "user-1" },
      { table: "posts", columns: "*", column: "user_id", value: "user-1" },
      { table: "user_favorites", columns: "*", column: "user_id", value: "user-1" },
      { table: "saved_products", columns: "*", column: "user_id", value: "user-1" },
    ]);
    if (out.ok) expect(out.payload.savedProducts).toEqual([{ id: "s1" }]);
  });

  test("still exports everything else when the saved pieces table is absent", async () => {
    const out = await fetchAccountExport(
      ACCOUNT,
      fakeClient({ saved_products: FAIL("PGRST205") }, []),
      EXPORTED_AT,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect("savedProducts" in out.payload).toBe(false);
  });

  test("a rejected request is a failed export, not a thrown error", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const client: ExportClient = {
      from() {
        throw new TypeError("Failed to fetch");
      },
    };
    const out = await fetchAccountExport(ACCOUNT, client, EXPORTED_AT);
    spy.mockRestore();
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toBe("We couldn't prepare your data export. Please try again.");
    expect(out.failures).toEqual([]);
  });

  test("a rejection that is not an Error still logs what it was", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const client: ExportClient = {
      from() {
        throw "connection dropped";
      },
    };
    const out = await fetchAccountExport(ACCOUNT, client, EXPORTED_AT);
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(out.ok).toBe(false);
    expect(logged).toContain("connection dropped");
  });

  test("names the table that failed and logs the cause without any row data", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const out = await fetchAccountExport(
      ACCOUNT,
      fakeClient(
        { saved_products: FAIL("57014"), outfits: OK([{ id: "o1", image_url: "private.png" }]) },
        [],
      ),
      EXPORTED_AT,
    );
    const logged = JSON.stringify(spy.mock.calls);
    const callCount = spy.mock.calls.length;
    spy.mockRestore();

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toBe("We couldn't include your saved pieces. Try again in a moment.");
    expect(callCount).toBe(1);
    expect(logged).toContain("saved_products");
    expect(logged).toContain("57014");
    expect(logged).not.toContain("private.png");
    expect(logged).not.toContain(ACCOUNT.email);
  });

  test("a successful export logs nothing", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    await fetchAccountExport(ACCOUNT, fakeClient({}, []), EXPORTED_AT);
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(calls).toBe(0);
  });
});

describe("export failure messages", () => {
  function failedMessage(overrides: Partial<Parameters<typeof buildAccountExport>[0]>) {
    const out = build(overrides);
    return out.ok ? "" : out.message;
  }

  test("one failed section is named", () => {
    expect(failedMessage({ savedProducts: FAIL("57014") })).toBe(
      "We couldn't include your saved pieces. Try again in a moment.",
    );
    expect(failedMessage({ outfits: FAIL("57014") })).toBe(
      "We couldn't include your looks. Try again in a moment.",
    );
    expect(failedMessage({ profile: FAIL("42501") })).toBe(
      "We couldn't include your profile. Try again in a moment.",
    );
    expect(failedMessage({ posts: FAIL("42501") })).toBe(
      "We couldn't include your posts. Try again in a moment.",
    );
    expect(failedMessage({ favorites: FAIL("42501") })).toBe(
      "We couldn't include your favorites. Try again in a moment.",
    );
  });

  test("several failed sections are listed in plain words", () => {
    expect(failedMessage({ outfits: FAIL("57014"), posts: FAIL("57014") })).toBe(
      "We couldn't include your looks and posts. Try again in a moment.",
    );
    expect(
      failedMessage({
        profile: FAIL("57014"),
        outfits: FAIL("57014"),
        savedProducts: FAIL("57014"),
      }),
    ).toBe("We couldn't include your profile, looks and saved pieces. Try again in a moment.");
  });

  test("failures carry the table and code, never row data", () => {
    const out = build({ posts: FAIL("42501") });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.failures).toEqual([{ table: "posts", code: "42501", message: "raw db text" }]);
  });

  test("a missing optional table is not a failure and says nothing", () => {
    expect(build({ savedProducts: FAIL("PGRST205") }).ok).toBe(true);
  });

  test("copy has no em or en dashes", () => {
    const msg = failedMessage({ outfits: FAIL("57014"), savedProducts: FAIL("57014") });
    expect(msg).not.toMatch(/[–—]/);
  });
});
