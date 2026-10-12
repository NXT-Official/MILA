import { describe, expect, test } from "bun:test";
import { saveConciergeTurn } from "./concierge-turns";

type Op =
  | { kind: "select"; table: string; filters: Record<string, unknown> }
  | { kind: "insert"; table: string; rows: Array<Record<string, unknown>> }
  | { kind: "update"; table: string; values: Record<string, unknown>; filters: unknown[] };

/** A just-enough twin of the supabase-js query builder for these three calls. */
function fakeAdmin(
  opts: {
    failMessages?: boolean;
    failConversation?: boolean;
    /** Conversations that exist, as `${id}:${owner}`. */
    owned?: string[];
    ownershipError?: boolean;
  } = {},
) {
  const ops: Op[] = [];
  const db = {
    from(table: string) {
      return {
        select() {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq: (col: string, value: unknown) => {
              filters[col] = value;
              return chain;
            },
            maybeSingle: async () => {
              ops.push({ kind: "select", table, filters });
              if (opts.ownershipError) return { data: null, error: { message: "down" } };
              const hit = (opts.owned ?? []).includes(`${filters.id}:${filters.user_id}`);
              return { data: hit ? { id: filters.id } : null, error: null };
            },
          };
          return chain;
        },
        insert(input: Record<string, unknown> | Array<Record<string, unknown>>) {
          const rows = Array.isArray(input) ? input : [input];
          ops.push({ kind: "insert", table, rows });
          const failed =
            (table === "concierge_messages" && opts.failMessages) ||
            (table === "concierge_conversations" && opts.failConversation);
          const result = failed
            ? { data: null, error: { message: "boom" } }
            : {
                data: table === "concierge_conversations" ? { id: "conv-new" } : null,
                error: null,
              };
          return {
            select: () => ({ single: async () => result }),
            then: (resolve: (v: unknown) => unknown) => resolve(result),
          };
        },
        update(values: Record<string, unknown>) {
          const filters: unknown[] = [];
          ops.push({ kind: "update", table, values, filters });
          const chain = {
            eq: (...args: unknown[]) => {
              filters.push(args);
              return chain;
            },
            then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { db: db as never, ops };
}

const ARGS = {
  userId: "user-1",
  conversationId: null,
  message: "What goes with olive?",
  imageUrl: null,
  reply: "Cream and rust.",
};

describe("saveConciergeTurn", () => {
  test("a new conversation is created with a title, then both messages land in one insert", async () => {
    const { db, ops } = fakeAdmin();
    const out = await saveConciergeTurn(ARGS, db);

    expect(out).toEqual({ conversationId: "conv-new", saved: true });
    const conv = ops.find((o) => o.kind === "insert" && o.table === "concierge_conversations");
    expect(conv && conv.kind === "insert" && conv.rows[0]).toMatchObject({
      user_id: "user-1",
      title: "What goes with olive?",
    });
    const msgs = ops.filter((o) => o.kind === "insert" && o.table === "concierge_messages");
    expect(msgs).toHaveLength(1);
    const rows = msgs[0].kind === "insert" ? msgs[0].rows : [];
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(rows.every((r) => r.conversation_id === "conv-new" && r.user_id === "user-1")).toBe(
      true,
    );
    // Ordered by created_at: the user turn must sort before the reply.
    expect(String(rows[0].created_at) < String(rows[1].created_at)).toBe(true);
  });

  test("an existing conversation is appended to and its updated_at is bumped", async () => {
    const { db, ops } = fakeAdmin({ owned: ["conv-1:user-1"] });
    const out = await saveConciergeTurn({ ...ARGS, conversationId: "conv-1" }, db);

    expect(out).toEqual({ conversationId: "conv-1", saved: true });
    expect(ops.some((o) => o.kind === "insert" && o.table === "concierge_conversations")).toBe(
      false,
    );
    expect(ops.some((o) => o.kind === "update" && o.table === "concierge_conversations")).toBe(
      true,
    );
  });

  test("the attached photo is recorded on the user message only", async () => {
    const { db, ops } = fakeAdmin();
    await saveConciergeTurn({ ...ARGS, imageUrl: "https://x.test/p.jpg" }, db);
    const msgs = ops.find((o) => o.kind === "insert" && o.table === "concierge_messages");
    const rows = msgs && msgs.kind === "insert" ? msgs.rows : [];
    expect(rows[0].image_url).toBe("https://x.test/p.jpg");
    expect(rows[1].image_url ?? null).toBeNull();
  });

  test("a failed message insert answers saved false with the conversation it created", async () => {
    const { db } = fakeAdmin({ failMessages: true });
    expect(await saveConciergeTurn(ARGS, db)).toEqual({ conversationId: "conv-new", saved: false });
  });

  test("a failed conversation insert answers saved false and no id", async () => {
    const { db, ops } = fakeAdmin({ failConversation: true });
    expect(await saveConciergeTurn(ARGS, db)).toEqual({ conversationId: null, saved: false });
    expect(ops.some((o) => o.kind === "insert" && o.table === "concierge_messages")).toBe(false);
  });

  test("saveConciergeTurn writes into her own conversation", async () => {
    const { db, ops } = fakeAdmin({ owned: ["conv-1:user-1"] });
    const out = await saveConciergeTurn({ ...ARGS, conversationId: "conv-1" }, db);
    expect(out).toEqual({ conversationId: "conv-1", saved: true });
    const read = ops.find((o) => o.kind === "select");
    expect(read && read.kind === "select" && read.filters).toEqual({
      id: "conv-1",
      user_id: "user-1",
    });
    const msgs = ops.find((o) => o.kind === "insert" && o.table === "concierge_messages");
    const rows = msgs && msgs.kind === "insert" ? msgs.rows : [];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.user_id === "user-1" && r.conversation_id === "conv-1")).toBe(true);
  });

  test("saveConciergeTurn refuses a conversation owned by another member and writes nothing", async () => {
    const { db, ops } = fakeAdmin({ owned: ["conv-1:user-2"] });
    const out = await saveConciergeTurn({ ...ARGS, conversationId: "conv-1" }, db);
    expect(out).toEqual({ conversationId: "conv-1", saved: false });
    expect(ops.some((o) => o.kind === "insert" || o.kind === "update")).toBe(false);
  });

  test("an ownership refusal is reported with the user id and no message text", async () => {
    const { db } = fakeAdmin({ owned: ["conv-1:user-2"] });
    const reported: unknown[] = [];
    await saveConciergeTurn({ ...ARGS, conversationId: "conv-1" }, db, (e) => reported.push(e));
    expect(reported).toHaveLength(1);
    const text = String((reported[0] as Error).message);
    expect(text).toContain("user-1");
    expect(text).not.toContain(ARGS.message);
    expect(text).not.toContain(ARGS.reply);
  });

  test("saveConciergeTurn fails closed when the ownership read errors: no insert", async () => {
    const { db, ops } = fakeAdmin({ owned: ["conv-1:user-1"], ownershipError: true });
    const out = await saveConciergeTurn({ ...ARGS, conversationId: "conv-1" }, db);
    expect(out.saved).toBe(false);
    expect(ops.some((o) => o.kind === "insert" || o.kind === "update")).toBe(false);
  });
});
