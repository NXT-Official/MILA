import { describe, expect, test } from "bun:test";

import type { AiResult } from "@/lib/ai.server";
import type { withAiCredit } from "@/lib/credits.server";
import { createAvailabilityCache, type GenerationJobDeps } from "@/lib/generation-jobs.server";
import { AiUnavailableError, DomainValidationError } from "@/server/http/api-errors";

import { MemoryGenerationJobStore } from "../../../tests/helpers/memory-generation-job-store";
import { analyzeOutfitItemsForUser, replacePostItems, type ItemsDeps } from "./items";

const USER = "user-1";
const OTHER = "user-2";
const POST = "11111111-1111-4111-8111-111111111111";
const OTHER_POST = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";

type Row = Record<string, unknown>;

/**
 * An in-memory `posts` + `post_items` database. Both the member client and the
 * service-role client are built from it, and every call to post_items is
 * recorded with the filters it carried, so a test can prove which post a write
 * could reach.
 */
function fakeDatabase() {
  const posts: Row[] = [
    { id: POST, user_id: USER, image_url_back: "u1/back.jpg" },
    { id: OTHER_POST, user_id: OTHER, image_url_back: "u2/back.jpg" },
  ];
  let items: Row[] = [
    { id: "old-mine", post_id: POST, label: "Old tag" },
    { id: "theirs-1", post_id: OTHER_POST, label: "Her blazer" },
    { id: "theirs-2", post_id: OTHER_POST, label: "Her skirt" },
  ];
  const jobs: Row[] = [];
  const state: {
    failDelete: ((ids: string[] | null) => boolean) | null;
    failInsert: boolean;
    seq: number;
  } = { failDelete: null, failInsert: false, seq: 0 };
  const writes: Array<{ client: string; op: "delete" | "insert"; filters: Row; rows?: Row[] }> = [];
  const reads: Array<{ client: string; table: string }> = [];

  const client = (name: string) => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://signed.test/${path}` },
          error: null,
        }),
      }),
    },
    from(table: string) {
      return {
        select() {
          reads.push({ client: name, table });
          const filters: Row = {};
          const chain = {
            eq: (col: string, value: unknown) => {
              filters[col] = value;
              return chain;
            },
            maybeSingle: async () => {
              const source = table === "generation_jobs" ? jobs : posts;
              const found = source.find((p) =>
                Object.entries(filters).every(([col, value]) => p[col] === value),
              );
              return { data: found ?? null, error: null };
            },
            then: (resolve: (v: unknown) => unknown) =>
              resolve({
                data: items
                  .filter((row) =>
                    Object.entries(filters).every(([col, value]) => row[col] === value),
                  )
                  .map((row) => ({ id: row.id })),
                error: null,
              }),
          };
          return chain;
        },
        delete() {
          const filters: Row = {};
          let ids: string[] | null = null;
          const chain = {
            eq: (col: string, value: unknown) => {
              filters[col] = value;
              return chain;
            },
            in: (_col: string, value: string[]) => {
              ids = value;
              filters.id = value;
              return chain;
            },
            then: (resolve: (v: unknown) => unknown) => {
              writes.push({ client: name, op: "delete", filters: { ...filters } });
              if (state.failDelete && state.failDelete(ids)) {
                return resolve({ error: { message: "delete boom" } });
              }
              items = items.filter(
                (row) =>
                  !(
                    row.post_id === filters.post_id &&
                    (ids === null || ids.includes(String(row.id)))
                  ),
              );
              return resolve({ error: null });
            },
          };
          return chain;
        },
        insert(input: Row[]) {
          writes.push({ client: name, op: "insert", filters: {}, rows: input });
          return {
            select: () => ({
              then: (resolve: (v: unknown) => unknown) => {
                if (state.failInsert) return resolve({ data: null, error: { message: "boom" } });
                const stored = input.map((row) => ({
                  ...row,
                  id: `new-${(state.seq += 1)}`,
                  source_url: null,
                }));
                items.push(...stored);
                return resolve({ data: stored, error: null });
              },
            }),
          };
        },
      };
    },
  });

  return {
    member: client("member") as never,
    admin: client("admin") as never,
    state,
    jobs,
    writes,
    reads,
    itemsOf: (postId: string) => items.filter((row) => row.post_id === postId),
  };
}

const garment = (name: string) => ({
  name,
  category: "Tops",
  primary_color: "Cream",
  color_undertone: "Warm",
  silhouette_tags: ["relaxed", "cropped"],
  bbox: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
});

const found = (...names: string[]): AiResult => ({
  ok: true,
  args: { items: names.map(garment) },
});

function scriptedAi(replies: AiResult[], seen: unknown[] = []) {
  return (async (messages: unknown) => {
    seen.push(messages);
    const next = replies.shift();
    if (!next) throw new Error("scriptedAi: no scripted response left");
    return next;
  }) as never;
}

function setup() {
  const store = new MemoryGenerationJobStore();
  store.seed(USER, 3);
  const db = fakeDatabase();
  const counter = { legacyCharges: 0, legacyRefunds: 0, rateLimits: 0 };
  const legacyCredit: typeof withAiCredit = async (_s, _u, produce, opts) => {
    counter.legacyCharges += 1;
    const value = await produce();
    if (opts?.refundIf?.(value)) counter.legacyRefunds += 1;
    return value;
  };
  const jobs: GenerationJobDeps = { store, availability: createAvailabilityCache(60_000) };
  const deps = (ai: ItemsDeps["ai"]): ItemsDeps => ({
    ai,
    jobs,
    withCredit: legacyCredit,
    dailyAllowance: async () => 3,
    rateLimit: async () => {
      counter.rateLimits += 1;
    },
    admin: async () => db.admin,
  });
  return { store, db, counter, deps };
}

describe("analyzeOutfitItemsForUser as a generation job", () => {
  test("zero items: refunded once, post_items untouched", async () => {
    const { store, db, deps } = setup();
    const out = await analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([{ ok: true, args: { items: [] } }])),
    );

    expect(out).toEqual([]);
    expect(db.writes).toHaveLength(0);
    expect(db.itemsOf(POST).map((r) => r.id)).toEqual(["old-mine"]);
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
    expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "no_items_found" });

    // Asking again with the same id answers the same empty result, refunds nothing more.
    const again = await analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([])),
    );
    expect(again).toEqual([]);
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
  });

  test("items: post_items replaced inside the job, before it completes", async () => {
    const { store, db, deps } = setup();
    let itemsWhenCompleted: string[] | null = null;
    const complete = store.complete.bind(store);
    store.complete = async (...args) => {
      itemsWhenCompleted = db.itemsOf(POST).map((r) => String(r.label));
      return complete(...args);
    };

    const out = await analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([found("Cream knit", "Wide jeans")])),
    );

    expect(out.map((i) => i.label)).toEqual(["Cream knit", "Wide jeans"]);
    expect(itemsWhenCompleted as string[] | null).toEqual(["Cream knit", "Wide jeans"]);
    expect(db.itemsOf(POST).map((r) => r.label)).toEqual(["Cream knit", "Wide jeans"]);
    expect(store.rows[0]).toMatchObject({ status: "succeeded" });
    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });
    // The write ran with the service role, never the member's request client.
    expect(db.writes.every((w) => w.client === "admin")).toBe(true);
  });

  test("replay: stored items, no second AI call, no second write", async () => {
    const { store, db, deps } = setup();
    const input = { post_id: POST, clientRequestId: REQUEST_ID };
    const first = await analyzeOutfitItemsForUser(
      db.member,
      USER,
      input,
      {},
      deps(scriptedAi([found("Cream knit")])),
    );
    const writesAfterFirst = db.writes.length;

    // The script is empty: any provider call would throw.
    const replay = await analyzeOutfitItemsForUser(
      db.member,
      USER,
      input,
      {},
      deps(scriptedAi([])),
    );

    expect(replay).toEqual(first);
    expect(db.writes).toHaveLength(writesAfterFirst);
    expect(store.rows).toHaveLength(1);
    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });
  });

  test("a foreign post is refused before any charge", async () => {
    const { store, db, counter, deps } = setup();
    const seen: unknown[] = [];
    const promise = analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: OTHER_POST, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([found("never")], seen)),
    );

    await expect(promise).rejects.toBeInstanceOf(DomainValidationError);
    expect(store.calls.start).toBe(0);
    expect(store.rows).toHaveLength(0);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
    expect(counter.legacyCharges).toBe(0);
    expect(seen).toHaveLength(0);
    expect(db.writes).toHaveLength(0);
  });

  test("a post_items write failure refunds once", async () => {
    const { store, db, deps } = setup();
    db.state.failInsert = true;
    const promise = analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([found("Cream knit")])),
    );

    await expect(promise).rejects.toThrow();
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
    expect(store.rows[0]).toMatchObject({ status: "failed" });
  });

  test("the old tags are deleted by id after the new ones are in, never before", async () => {
    const { db, deps } = setup();
    await analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([found("Cream knit")])),
    );
    expect(db.writes.map((w) => w.op)).toEqual(["insert", "delete"]);
    expect(db.writes[1].filters).toEqual({ post_id: POST, id: ["old-mine"] });
  });

  test("an insert failure deletes nothing: she keeps her old tags, refunded once", async () => {
    const { store, db, deps } = setup();
    db.state.failInsert = true;
    const promise = analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([found("Cream knit")])),
    );

    await expect(promise).rejects.toThrow();
    expect(db.writes.some((w) => w.op === "delete")).toBe(false);
    expect(db.itemsOf(POST).map((r) => r.id)).toEqual(["old-mine"]);
    expect(store.calls.refunds).toBe(1);
  });

  test("a failed delete of the old ids removes the NEW ids: old set kept, refunded once", async () => {
    const { store, db, deps } = setup();
    db.state.failDelete = (ids) => ids?.includes("old-mine") ?? false;
    const promise = analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([found("Cream knit", "Wide jeans")])),
    );

    await expect(promise).rejects.toThrow();
    expect(db.itemsOf(POST).map((r) => r.id)).toEqual(["old-mine"]);
    const cleanup = db.writes.filter((w) => w.op === "delete").at(-1);
    expect(cleanup?.filters).toEqual({ post_id: POST, id: ["new-1", "new-2"] });
    expect(db.itemsOf(OTHER_POST)).toHaveLength(2);
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
  });

  test("a detection that outlives its deadline writes nothing and leaves her tags as they were", async () => {
    const { store, db, deps } = setup();
    const lateAi = (async () => {
      // The reaper (or the deadline) failed and refunded the job while the
      // provider call was still running.
      await store.fail(store.rows[0].id, "deadline_exceeded", true);
      return found("Cream knit");
    }) as never;
    const out = await analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(lateAi),
    );

    expect(out).toEqual([]);
    expect(db.writes).toHaveLength(0);
    expect(db.itemsOf(POST).map((r) => r.id)).toEqual(["old-mine"]);
    expect(store.calls.refunds).toBe(1);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
  });

  test("a request id replayed with a different post is refused before any charge", async () => {
    const { store, db, deps } = setup();
    db.jobs.push({
      user_id: USER,
      client_request_id: REQUEST_ID,
      kind: "item_detection",
      input: { post_id: OTHER_POST },
    });
    const seen: unknown[] = [];
    const promise = analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([found("never")], seen)),
    );

    await expect(promise).rejects.toThrow("This request was already used for another post.");
    await expect(promise).rejects.toBeInstanceOf(DomainValidationError);
    expect(store.calls.start).toBe(0);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
    expect(seen).toHaveLength(0);
    expect(db.writes).toHaveLength(0);
  });

  test("an AI failure refunds once and throws the calm error", async () => {
    const { store, db, deps } = setup();
    const promise = analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([{ ok: false } as AiResult])),
    );

    await expect(promise).rejects.toBeInstanceOf(AiUnavailableError);
    expect(store.calls.refunds).toBe(1);
    expect(db.writes).toHaveLength(0);
  });

  test("a second request while one runs is reported with its job id", async () => {
    const { store, db, deps } = setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowAi = (async () => {
      await gate;
      return found("Cream knit");
    }) as never;
    const first = analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(slowAi),
    );
    // Let the first reach the provider call.
    while (store.rows.length === 0) await new Promise((r) => setTimeout(r, 1));

    const second = await analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: "7a9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f" },
      { inFlight: "report" },
      deps(scriptedAi([])),
    );
    release();
    await first;

    expect(second).toEqual({ status: "running", jobId: store.rows[0].id });
    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });
  });

  test("migration missing: today's sequence unchanged", async () => {
    const { store, db, counter, deps } = setup();
    store.missing = true;
    const out = await analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([found("Cream knit")])),
    );

    expect(out.map((i) => i.label)).toEqual(["Cream knit"]);
    expect(counter.legacyCharges).toBe(1);
    expect(counter.legacyRefunds).toBe(0);
    // Today's write: the member's own client, delete then insert, no job row.
    expect(db.writes.map((w) => `${w.client}:${w.op}`)).toEqual(["member:delete", "member:insert"]);
    expect(store.rows).toHaveLength(0);

    const empty = await analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST },
      {},
      deps(scriptedAi([{ ok: true, args: { items: [] } }])),
    );
    expect(empty).toEqual([]);
    expect(counter.legacyRefunds).toBe(1);
  });

  test("an old client (no clientRequestId) still gets a plain item array", async () => {
    const { store, db, deps } = setup();
    const out = await analyzeOutfitItemsForUser(
      db.member,
      USER,
      { post_id: POST },
      {},
      deps(scriptedAi([found("Cream knit")])),
    );
    expect(Array.isArray(out)).toBe(true);
    expect(store.rows).toHaveLength(1);
  });
});

describe("replacePostItems (service role) can only touch the verified post", () => {
  const rows = [
    {
      label: "Cream knit",
      category: "Tops",
      attributes: {},
      bbox: { x: 0, y: 0, w: 1, h: 1 },
    },
  ];

  test("every delete and insert is scoped to the post, and the other member's tags survive", async () => {
    const db = fakeDatabase();
    await replacePostItems(db.admin, { userId: USER, postId: POST, items: rows });

    const deletes = db.writes.filter((w) => w.op === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toEqual({ post_id: POST, id: ["old-mine"] });
    const inserts = db.writes.filter((w) => w.op === "insert");
    expect(inserts.every((w) => w.rows?.every((r) => r.post_id === POST))).toBe(true);
    expect(db.itemsOf(OTHER_POST).map((r) => r.id)).toEqual(["theirs-1", "theirs-2"]);
  });

  test("a post that is not hers is refused and nothing is written", async () => {
    const db = fakeDatabase();
    const attempt = replacePostItems(db.admin, { userId: USER, postId: OTHER_POST, items: rows });

    await expect(attempt).rejects.toBeInstanceOf(DomainValidationError);
    expect(db.writes).toHaveLength(0);
    expect(db.itemsOf(OTHER_POST).map((r) => r.id)).toEqual(["theirs-1", "theirs-2"]);
  });

  test("a post that does not exist is refused and nothing is written", async () => {
    const db = fakeDatabase();
    const attempt = replacePostItems(db.admin, {
      userId: USER,
      postId: "33333333-3333-4333-8333-333333333333",
      items: rows,
    });
    await expect(attempt).rejects.toBeInstanceOf(DomainValidationError);
    expect(db.writes).toHaveLength(0);
  });
});
