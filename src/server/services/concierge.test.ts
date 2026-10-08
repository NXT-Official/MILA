import { describe, expect, test } from "bun:test";

import type { AiResult } from "@/lib/ai.server";
import type { withAiCredit } from "@/lib/credits.server";
import { createAvailabilityCache, type GenerationJobDeps } from "@/lib/generation-jobs.server";
import { AiUnavailableError, DomainValidationError } from "@/server/http/api-errors";

import { MemoryGenerationJobStore } from "../../../tests/helpers/memory-generation-job-store";
import { conciergeChatForUser, type ConciergeDeps } from "./concierge";
import { saveConciergeTurn } from "./concierge-turns";

const USER = "user-1";
const REQUEST_ID = "6f9c2a8e-3b1d-4c7a-9e2f-0a1b2c3d4e5f";
const CONVERSATION = "11111111-1111-4111-8111-111111111111";

/** The member client: an empty profile, and the conversations she owns. */
function memberClient(ownedConversations: string[] = []) {
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (col: string, value: unknown) => {
          filters[col] = value;
          return chain;
        },
        maybeSingle: async () => {
          if (table === "concierge_conversations") {
            const owned =
              filters.user_id === USER && ownedConversations.includes(String(filters.id));
            return { data: owned ? { id: filters.id } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };
  return { client: client as never };
}

/** A recording twin of the service-role client, so the writes are real. */
function adminRecorder(owned: string[] = []) {
  const conversations: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  let failMessages = false;
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
            maybeSingle: async () => ({
              data:
                filters.user_id === USER && owned.includes(String(filters.id))
                  ? { id: filters.id }
                  : null,
              error: null,
            }),
          };
          return chain;
        },
        insert(input: Record<string, unknown> | Array<Record<string, unknown>>) {
          const rows = Array.isArray(input) ? input : [input];
          if (table === "concierge_conversations") {
            const row = { id: `conv-${conversations.length + 1}`, ...rows[0] };
            conversations.push(row);
            const result = { data: { id: row.id }, error: null };
            return { select: () => ({ single: async () => result }) };
          }
          const result = failMessages ? { error: { message: "boom" } } : { error: null };
          if (!failMessages) messages.push(...rows);
          return { then: (resolve: (v: unknown) => unknown) => resolve(result) };
        },
        update() {
          const chain = {
            eq: () => chain,
            then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
          };
          return chain;
        },
      };
    },
  };
  return {
    db: db as never,
    conversations,
    messages,
    failMessages: () => {
      failMessages = true;
    },
  };
}

function scriptedAi(replies: AiResult[], seen: Array<Array<Record<string, unknown>>> = []) {
  return (async (messages: Array<Record<string, unknown>>) => {
    seen.push(messages);
    const next = replies.shift();
    if (!next) throw new Error("scriptedAi: no scripted response left");
    return next;
  }) as never;
}

const ok = (reply: string): AiResult => ({ ok: true, args: { reply } });

function setup(opts: { owned?: string[] } = {}) {
  const store = new MemoryGenerationJobStore();
  store.seed(USER, 3);
  const admin = adminRecorder(opts.owned);
  const member = memberClient(opts.owned);
  const counter = { legacyCharges: 0, rateLimits: 0 };
  const countingWithCredit: typeof withAiCredit = async (_s, _u, produce) => {
    counter.legacyCharges += 1;
    return produce();
  };
  const jobs: GenerationJobDeps = { store, availability: createAvailabilityCache(60_000) };
  const deps = (ai: ConciergeDeps["ai"]): ConciergeDeps => ({
    ai,
    jobs,
    withCredit: countingWithCredit,
    dailyAllowance: async () => 3,
    rateLimit: async () => {
      counter.rateLimits += 1;
    },
    assertImageUrl: (url) => url,
    saveTurn: (args) => saveConciergeTurn(args, admin.db),
  });
  return { store, admin, member, counter, deps };
}

const BASE = { message: "What goes with olive?", history: [] };

describe("conciergeChatForUser saveTurn", () => {
  test("one conversation and one pair of messages per clientRequestId, even when replayed", async () => {
    const { store, admin, member, deps } = setup();
    const ai = scriptedAi([ok("Cream and rust.")]);
    const input = { ...BASE, clientRequestId: REQUEST_ID, saveTurn: true };

    const first = await conciergeChatForUser(member.client, USER, input, {}, deps(ai));
    expect(first).toMatchObject({
      reply: "Cream and rust.",
      conversationId: "conv-1",
      saved: true,
    });

    // The same request again: the stored answer comes back. The script is empty,
    // so any provider call would throw; the writes must not repeat either.
    const replay = await conciergeChatForUser(member.client, USER, input, {}, deps(ai));
    expect(replay).toMatchObject({
      reply: "Cream and rust.",
      conversationId: "conv-1",
      saved: true,
    });

    expect(admin.conversations).toHaveLength(1);
    expect(admin.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(store.rows).toHaveLength(1);
    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });
  });

  test("a turn appended to her own conversation reuses its id", async () => {
    const { admin, member, deps } = setup({ owned: [CONVERSATION] });
    const out = await conciergeChatForUser(
      member.client,
      USER,
      { ...BASE, clientRequestId: REQUEST_ID, saveTurn: true, conversationId: CONVERSATION },
      {},
      deps(scriptedAi([ok("Yes.")])),
    );
    expect(out).toMatchObject({ conversationId: CONVERSATION, saved: true });
    expect(admin.conversations).toHaveLength(0);
    expect(admin.messages.every((m) => m.conversation_id === CONVERSATION)).toBe(true);
  });

  test("a foreign conversationId is refused before any job or charge", async () => {
    const { store, admin, member, deps } = setup({ owned: [] });
    const seen: Array<Array<Record<string, unknown>>> = [];
    const promise = conciergeChatForUser(
      member.client,
      USER,
      { ...BASE, clientRequestId: REQUEST_ID, saveTurn: true, conversationId: CONVERSATION },
      {},
      deps(scriptedAi([ok("never")], seen)),
    );
    await expect(promise).rejects.toBeInstanceOf(DomainValidationError);
    expect(store.calls.start).toBe(0);
    expect(store.rows).toHaveLength(0);
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
    expect(seen).toHaveLength(0);
    expect(admin.messages).toHaveLength(0);
  });

  test("a reply over 8000 characters is stored ending in an ellipsis, never dropped", async () => {
    const { admin, member, deps } = setup();
    const out = await conciergeChatForUser(
      member.client,
      USER,
      { ...BASE, clientRequestId: REQUEST_ID, saveTurn: true },
      {},
      deps(scriptedAi([ok("x".repeat(9000))])),
    );
    if ("status" in out) throw new Error("expected a reply");
    expect(out.reply).toHaveLength(8000);
    expect(out.reply.endsWith("…")).toBe(true);
    const stored = admin.messages.find((m) => m.role === "assistant");
    expect(String(stored?.content)).toHaveLength(8000);
  });

  test("a reply cut at an emoji never leaves half of it", async () => {
    const { admin, member, deps } = setup();
    const out = await conciergeChatForUser(
      member.client,
      USER,
      { ...BASE, clientRequestId: REQUEST_ID, saveTurn: true },
      {},
      deps(scriptedAi([ok(`${"x".repeat(7998)}😀😀`)])),
    );
    if ("status" in out) throw new Error("expected a reply");
    expect(out.reply.length).toBeLessThanOrEqual(8000);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out.reply)).toBe(false);
    expect(out.reply.endsWith("…")).toBe(true);
    expect(String(admin.messages.find((m) => m.role === "assistant")?.content)).toBe(out.reply);
  });

  test("a produce that outlives its deadline writes no conversation or messages, and is refunded", async () => {
    const { store, admin, member, deps } = setup();
    const slowAi = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return ok("Too late.");
    }) as never;
    const base = deps(slowAi);
    const promise = conciergeChatForUser(
      member.client,
      USER,
      { ...BASE, clientRequestId: REQUEST_ID, saveTurn: true },
      {},
      { ...base, deadlineSeconds: 0.03, jobs: { ...base.jobs, persistReserveMs: 0 } },
    );
    await expect(promise).rejects.toBeInstanceOf(AiUnavailableError);
    // Let the abandoned produce finish and try to write.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(admin.conversations).toHaveLength(0);
    expect(admin.messages).toHaveLength(0);
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].credit_state).toBe("refunded");
    expect(store.calls.refunds).toBe(1);
  });

  test("a failed re-read of the job writes nothing", async () => {
    const { store, admin, member, deps } = setup();
    store.get = async () => {
      throw new Error("db down");
    };
    const out = await conciergeChatForUser(
      member.client,
      USER,
      { ...BASE, clientRequestId: REQUEST_ID, saveTurn: true },
      {},
      deps(scriptedAi([ok("Fine.")])),
    );
    expect(out).toMatchObject({ reply: "Fine.", saved: false });
    expect(admin.conversations).toHaveLength(0);
    expect(admin.messages).toHaveLength(0);
  });

  test("a failed message insert answers saved false with the conversation id it created", async () => {
    const { store, admin, member, deps } = setup();
    admin.failMessages();
    const out = await conciergeChatForUser(
      member.client,
      USER,
      { ...BASE, clientRequestId: REQUEST_ID, saveTurn: true },
      {},
      deps(scriptedAi([ok("Cream and rust.")])),
    );
    expect(out).toMatchObject({
      reply: "Cream and rust.",
      conversationId: "conv-1",
      saved: false,
    });
    // She received the reply she paid for: the charge stands, nothing is refunded.
    expect(store.rows[0].status).toBe("succeeded");
    expect(store.rows[0].credit_state).toBe("charged");
    expect(store.calls.refunds).toBe(0);
    expect(store.balance(USER)).toEqual({ daily: 2, purchased: 0 });
  });

  test("the job input never contains history", async () => {
    const { store, member, deps } = setup();
    await conciergeChatForUser(
      member.client,
      USER,
      {
        ...BASE,
        history: [
          { role: "user", content: "earlier question" },
          { role: "assistant", content: "earlier answer" },
        ],
        clientRequestId: REQUEST_ID,
        saveTurn: true,
      },
      {},
      deps(scriptedAi([ok("Fine.")])),
    );
    const input = store.rows[0].input as Record<string, unknown>;
    expect("history" in input).toBe(false);
    expect(JSON.stringify(input)).not.toContain("earlier");
    expect("clientRequestId" in input).toBe(false);
  });

  test("history still reaches the model even though it is not stored", async () => {
    const { member, deps } = setup();
    const seen: Array<Array<Record<string, unknown>>> = [];
    await conciergeChatForUser(
      member.client,
      USER,
      {
        ...BASE,
        history: [{ role: "user", content: "earlier question" }],
        clientRequestId: REQUEST_ID,
      },
      {},
      deps(scriptedAi([ok("Fine.")], seen)),
    );
    expect(JSON.stringify(seen[0])).toContain("earlier question");
  });

  test("without saveTurn the job runs but nothing is written, saved false", async () => {
    const { admin, member, deps } = setup();
    const out = await conciergeChatForUser(
      member.client,
      USER,
      { ...BASE, clientRequestId: REQUEST_ID },
      {},
      deps(scriptedAi([ok("Fine.")])),
    );
    expect(out).toMatchObject({ reply: "Fine.", saved: false });
    expect(admin.messages).toHaveLength(0);
    expect(admin.conversations).toHaveLength(0);
  });

  test("a failed reply refunds its one charge and writes nothing", async () => {
    const { store, admin, member, deps } = setup();
    const promise = conciergeChatForUser(
      member.client,
      USER,
      { ...BASE, clientRequestId: REQUEST_ID, saveTurn: true },
      {},
      deps(scriptedAi([{ ok: false, status: 500 }])),
    );
    await expect(promise).rejects.toBeInstanceOf(AiUnavailableError);
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].credit_state).toBe("refunded");
    expect(store.balance(USER)).toEqual({ daily: 3, purchased: 0 });
    expect(admin.messages).toHaveLength(0);
  });

  test("the same turn already running is reported, not charged, with inFlight report", async () => {
    const { store, member, deps } = setup();
    store.rows.push({
      id: "job-live",
      user_id: USER,
      kind: "concierge",
      client_request_id: "other-request",
      status: "running",
      credit_state: "charged",
      charged_from: "daily",
      input: {
        message: BASE.message,
        lookId: null,
        imageUrl: null,
        conversationId: null,
        saveTurn: true,
      },
      result: null,
      image_path: null,
      error_code: null,
      deadline_at: new Date(Date.now() + 200_000).toISOString(),
      created_at: new Date().toISOString(),
      completed_at: null,
    });
    const out = await conciergeChatForUser(
      member.client,
      USER,
      { ...BASE, clientRequestId: REQUEST_ID, saveTurn: true },
      { inFlight: "report" },
      deps(scriptedAi([])),
    );
    expect(out).toEqual({ status: "running", jobId: "job-live" });
  });
});

describe("conciergeChatForUser while the migration is missing", () => {
  test("the old path: one legacy charge, saved false, no server write", async () => {
    const { admin, member, counter, deps } = setup();
    const base = deps(scriptedAi([ok("Cream and rust.")]));
    const out = await conciergeChatForUser(
      member.client,
      USER,
      { ...BASE, clientRequestId: REQUEST_ID, saveTurn: true, conversationId: null },
      {},
      { ...base, jobs: { availability: { isMissing: () => true, markMissing: () => {} } } },
    );
    expect(out).toEqual({ reply: "Cream and rust.", conversationId: null, saved: false });
    expect(counter.legacyCharges).toBe(1);
    expect(admin.messages).toHaveLength(0);
    expect(admin.conversations).toHaveLength(0);
  });

  test("a request with none of the new fields still gets a reply", async () => {
    const { member, deps } = setup();
    const out = await conciergeChatForUser(
      member.client,
      USER,
      BASE,
      {},
      deps(scriptedAi([ok("Fine.")])),
    );
    expect(out).toMatchObject({ reply: "Fine." });
  });
});
