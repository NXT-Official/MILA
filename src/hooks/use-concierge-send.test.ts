import { describe, expect, test } from "bun:test";
import {
  createFeaturePressKeys,
  featureMutationKey,
  parseFeatureJobRow,
  type FeatureJob,
} from "@/lib/queries/feature-jobs";
import type { ConciergeReply } from "@/lib/concierge-chat.functions";
import type { FeatureJobOffer } from "@/lib/feature-job-offer";
import {
  CONCIERGE_CALL_TIMEOUT_MS,
  CONCIERGE_COPY,
  ConciergeLostAnswerError,
  applyConciergeRecovery,
  attachmentFingerprint,
  callConcierge,
  conciergeFingerprint,
  conciergeRecovery,
  conciergeReplyFrom,
  createConciergePendingStore,
  createConciergeSender,
  createConciergeWriteClaims,
  guardConciergeFetch,
  isConciergeLostAnswer,
  keepUnsavedTurns,
  saveConciergeExchange,
  type ConciergeCallVariables,
  type ConciergeDb,
  type ConciergePersistArgs,
  type ConciergePersistOutcome,
  type ConciergeRecoveryDeps,
  type ConciergeSenderDeps,
} from "./use-concierge-send";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";
const NEW_CONV = "44444444-4444-4444-8444-444444444444";
const PHOTO_URL = "https://project.supabase.co/storage/v1/object/public/outfits/u/p.jpg";
const NOW = new Date(2026, 9, 7, 13, 0, 0).getTime();

function photo(name = "look.jpg") {
  return new File([new Uint8Array([1, 2, 3])], name, {
    type: "image/jpeg",
    lastModified: 1_700_000,
  });
}

function ids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

/** A fake chat server: answers in order from `script`, records every call. */
function chatServer(
  script: Array<ConciergeReply | Error | ((v: ConciergeCallVariables) => ConciergeReply)>,
) {
  const calls: ConciergeCallVariables[] = [];
  return {
    calls,
    call: async (variables: ConciergeCallVariables): Promise<ConciergeReply> => {
      calls.push(variables);
      const next = script.shift();
      if (!next) throw new Error("no scripted answer");
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next(variables) : next;
    },
  };
}

function sender(overrides: Partial<ConciergeSenderDeps> & { call: ConciergeSenderDeps["call"] }) {
  const uploads: File[] = [];
  const persists: ConciergePersistArgs[] = [];
  const persistScript: ConciergePersistOutcome[] = [];
  const pending = createConciergePendingStore(() => null);
  const deps: ConciergeSenderDeps = {
    upload: async (_userId, file) => {
      uploads.push(file);
      return PHOTO_URL;
    },
    persist: async (args) => {
      persists.push(args);
      return (
        persistScript.shift() ?? {
          ok: true,
          conversationId: args.conversationId ?? NEW_CONV,
          created: args.conversationId === null,
          alreadySaved: false,
        }
      );
    },
    pressKeys: createFeaturePressKeys(ids()),
    pending,
    claims: createConciergeWriteClaims(),
    now: () => NOW,
    ...overrides,
  };
  return { send: createConciergeSender(deps), uploads, persists, persistScript, pending, deps };
}

const BASE = {
  userId: USER,
  message: "Does this suit my palette?",
  history: [],
  lookId: null,
  conversationId: null,
  file: null,
  uploadedUrl: null,
} as const;

function row(overrides: Record<string, unknown> = {}): FeatureJob {
  const parsed = parseFeatureJobRow({
    id: "job-1",
    kind: "concierge",
    client_request_id: "req-1",
    status: "running",
    credit_state: "charged",
    result: null,
    error_code: null,
    input: {
      message: "What goes with olive?",
      lookId: null,
      imageUrl: null,
      conversationId: null,
      saveTurn: true,
    },
    deadline_at: new Date(NOW + 4 * 60_000).toISOString(),
    created_at: new Date(NOW - 60_000).toISOString(),
    completed_at: null,
    ...overrides,
  });
  if (!parsed) throw new Error("fixture row did not parse");
  return parsed;
}

function view(job: FeatureJob | null, offer: FeatureJobOffer | null) {
  return { available: true, job, offer };
}

// ---------------------------------------------------------------------------

describe("the call", () => {
  test("asks the server to save the turn, with the request id and the open conversation", async () => {
    const seen: unknown[] = [];
    const chat = async (options: unknown) => {
      seen.push(options);
      return { reply: "Yes." };
    };
    await callConcierge(chat, {
      userId: USER,
      clientRequestId: "req-1",
      message: "Hi",
      history: [{ role: "user", content: "Earlier" }],
      lookId: null,
      imageUrl: PHOTO_URL,
      conversationId: CONV,
    });
    const options = seen[0] as { data: Record<string, unknown>; fetch?: unknown };
    expect(options.data).toEqual({
      message: "Hi",
      history: [{ role: "user", content: "Earlier" }],
      lookId: null,
      imageUrl: PHOTO_URL,
      clientRequestId: "req-1",
      conversationId: CONV,
      saveTurn: true,
    });
    expect(typeof options.fetch).toBe("function");
  });

  test("is bounded at 150 s", () => {
    expect(CONCIERGE_CALL_TIMEOUT_MS).toBe(150_000);
  });

  test("a gateway page (non-JSON 5xx) is a lost answer; Mila's own refusal passes through", async () => {
    const gateway = guardConciergeFetch(
      async () => new Response("<html>502</html>", { status: 502 }),
    );
    let thrown: unknown;
    await gateway("/_serverFn/x").catch((e) => (thrown = e));
    expect(thrown).toBeInstanceOf(ConciergeLostAnswerError);
    expect(isConciergeLostAnswer(thrown)).toBe(true);

    const ours = guardConciergeFetch(
      async () => new Response('{"t":1}', { status: 500, headers: { "x-tss-serialized": "true" } }),
    );
    const response = await ours("/_serverFn/x");
    expect(response.status).toBe(500);
  });

  test("timeouts and dropped connections are lost answers; a refusal is not", () => {
    const timeout = new Error("Timed out");
    timeout.name = "TimeoutError";
    expect(isConciergeLostAnswer(timeout)).toBe(true);
    expect(isConciergeLostAnswer(new TypeError("Failed to fetch"))).toBe(true);
    expect(
      isConciergeLostAnswer(new Error("Mila couldn't respond just now. Please try again.")),
    ).toBe(false);
  });

  test("the mutation is the concierge feature key", () => {
    expect(featureMutationKey("concierge")).toEqual(["generation", "concierge"]);
  });
});

describe("fingerprints", () => {
  test("the same message, photo and conversation give the same fingerprint, whatever the key order", () => {
    const file = photo();
    const a = conciergeFingerprint({
      conversationId: null,
      message: "Hi",
      lookId: null,
      attachment: attachmentFingerprint(file, null),
    });
    const b = conciergeFingerprint({
      attachment: attachmentFingerprint(file, PHOTO_URL),
      lookId: null,
      message: "Hi",
      conversationId: null,
    });
    expect(a).toBe(b);
  });

  test("a different photo, message or conversation is a different request", () => {
    const base = { conversationId: null, message: "Hi", lookId: null, attachment: null };
    const key = conciergeFingerprint(base);
    expect(conciergeFingerprint({ ...base, message: "Hello" })).not.toBe(key);
    expect(conciergeFingerprint({ ...base, conversationId: CONV })).not.toBe(key);
    expect(
      conciergeFingerprint({
        ...base,
        attachment: attachmentFingerprint(photo("other.jpg"), null),
      }),
    ).not.toBe(key);
  });
});

describe("sending a turn", () => {
  test("retry keeps the photo: the second send carries the same uploaded photo and uploads nothing again", async () => {
    const server = chatServer([
      new Error("Mila couldn't respond just now. Please try again."),
      { reply: "Lovely.", conversationId: NEW_CONV, saved: true, jobId: "job-2" },
    ]);
    const { send, uploads } = sender({ call: server.call });
    const file = photo();

    const first = await send.send({ ...BASE, file });
    expect(first.status).toBe("refused");
    if (first.status !== "refused") throw new Error("unreachable");
    expect(first.uploadedUrl).toBe(PHOTO_URL);

    const second = await send.send({
      ...BASE,
      file,
      uploadedUrl: first.uploadedUrl,
      previousRequestId: first.clientRequestId,
    });
    expect(second.status).toBe("answered");
    expect(uploads).toHaveLength(1);
    expect(server.calls.map((c) => c.imageUrl)).toEqual([PHOTO_URL, PHOTO_URL]);
  });

  test("retry keeps the photo even when the first upload never finished", async () => {
    const server = chatServer([{ reply: "Lovely.", conversationId: NEW_CONV, saved: true }]);
    let failUpload = true;
    const { send, uploads } = sender({
      call: server.call,
      upload: async (_userId, file) => {
        uploads.push(file);
        if (failUpload) {
          failUpload = false;
          throw new Error("upload failed");
        }
        return PHOTO_URL;
      },
    });
    const file = photo();
    const first = await send.send({ ...BASE, file });
    expect(first).toMatchObject({ status: "refused", stage: "upload", clientRequestId: null });
    expect(server.calls).toHaveLength(0);

    const second = await send.send({ ...BASE, file });
    expect(second.status).toBe("answered");
    expect(server.calls[0].imageUrl).toBe(PHOTO_URL);
  });

  test("a lost answer resends the same clientRequestId (one charge)", async () => {
    const timeout = new Error("Timed out");
    timeout.name = "TimeoutError";
    const server = chatServer([
      timeout,
      { reply: "Lovely.", conversationId: NEW_CONV, saved: true, jobId: "job-1" },
    ]);
    const { send } = sender({ call: server.call });
    const first = await send.send({ ...BASE });
    expect(first.status).toBe("lost");
    const second = await send.send({ ...BASE });
    expect(second.status).toBe("answered");
    expect(server.calls[1].clientRequestId).toBe(server.calls[0].clientRequestId);
  });

  test("a gateway page keeps the id too", async () => {
    const server = chatServer([new ConciergeLostAnswerError(502), { reply: "Ok.", saved: true }]);
    const { send } = sender({ call: server.call });
    expect((await send.send({ ...BASE })).status).toBe("lost");
    await send.send({ ...BASE });
    expect(server.calls[1].clientRequestId).toBe(server.calls[0].clientRequestId);
  });

  test("a real refusal retires the id, so the next press is a new request", async () => {
    const server = chatServer([
      new Error("Mila couldn't respond just now. Please try again."),
      { reply: "Ok.", saved: true },
    ]);
    const { send } = sender({ call: server.call });
    await send.send({ ...BASE });
    await send.send({ ...BASE });
    expect(server.calls[1].clientRequestId).not.toBe(server.calls[0].clientRequestId);
  });

  test("an answer retires the id: asking the same thing again later is a new request", async () => {
    const server = chatServer([
      { reply: "One.", saved: true },
      { reply: "Two.", saved: true },
    ]);
    const { send } = sender({ call: server.call });
    await send.send({ ...BASE });
    await send.send({ ...BASE });
    expect(server.calls[1].clientRequestId).not.toBe(server.calls[0].clientRequestId);
  });

  test("a double send sends one POST", async () => {
    let release: (value: ConciergeReply) => void = () => {};
    const calls: ConciergeCallVariables[] = [];
    const { send } = sender({
      call: (variables) => {
        calls.push(variables);
        return new Promise<ConciergeReply>((resolve) => (release = resolve));
      },
    });
    const first = send.send({ ...BASE });
    const second = await send.send({ ...BASE });
    expect(second).toEqual({ status: "busy" });
    release({ reply: "Ok.", saved: true });
    await first;
    expect(calls).toHaveLength(1);
  });

  test("server-saved replies make no client inserts", async () => {
    const server = chatServer([
      { reply: "Lovely.", conversationId: NEW_CONV, saved: true, jobId: "job-1" },
    ]);
    const { send, persists } = sender({ call: server.call });
    const outcome = await send.send({ ...BASE });
    expect(persists).toHaveLength(0);
    expect(outcome).toMatchObject({
      status: "answered",
      conversationId: NEW_CONV,
      saved: true,
      savedBy: "server",
      jobId: "job-1",
    });
  });

  test("saved false: the client writes the turn once, into the conversation the server created", async () => {
    const server = chatServer([
      { reply: "Lovely.", conversationId: NEW_CONV, saved: false, jobId: "job-1" },
    ]);
    const { send, persists } = sender({ call: server.call });
    const outcome = await send.send({ ...BASE, file: photo() });
    expect(persists).toHaveLength(1);
    expect(persists[0]).toMatchObject({
      userId: USER,
      conversationId: NEW_CONV,
      message: BASE.message,
      imageUrl: PHOTO_URL,
      reply: "Lovely.",
      jobId: "job-1",
      dedupe: true,
    });
    expect(outcome).toMatchObject({ status: "answered", saved: true, savedBy: "client" });
  });

  test("a persist failure shows Not saved yet, and Save retries without a chat call", async () => {
    const server = chatServer([
      { reply: "Lovely.", conversationId: CONV, saved: false, jobId: "job-1" },
    ]);
    const harness = sender({ call: server.call });
    harness.persistScript.push({
      ok: false,
      conversationId: CONV,
      created: false,
      stage: "messages",
    });
    const outcome = await harness.send.send({ ...BASE, conversationId: CONV });
    expect(outcome).toMatchObject({ status: "answered", saved: false });
    if (outcome.status !== "answered" || !outcome.save) throw new Error("expected a save to retry");
    expect(CONCIERGE_COPY.unsaved).toBe("Not saved to your history yet.");

    const again = await harness.send.saveAgain(outcome.save);
    expect(again.ok).toBe(true);
    expect(server.calls).toHaveLength(1);
    expect(harness.persists).toHaveLength(2);
    // The retry reads first, so a write that did land the first time is never doubled.
    expect(harness.persists[1].dedupe).toBe(true);
  });

  test("a turn already written in this tab is never written twice", async () => {
    const claims = createConciergeWriteClaims();
    claims.claim("job-1");
    claims.done("job-1");
    const server = chatServer([
      { reply: "Lovely.", conversationId: CONV, saved: false, jobId: "job-1" },
    ]);
    const { send, persists } = sender({ call: server.call, claims });
    const outcome = await send.send({ ...BASE, conversationId: CONV });
    expect(persists).toHaveLength(0);
    expect(outcome).toMatchObject({ status: "answered", saved: true });
  });

  test("migration missing: today's flow, the client creates the conversation and saves the pair", async () => {
    const server = chatServer([{ reply: "Lovely.", conversationId: null, saved: false }]);
    const { send, persists } = sender({ call: server.call });
    const outcome = await send.send({ ...BASE });
    expect(persists).toEqual([
      {
        userId: USER,
        conversationId: null,
        message: BASE.message,
        imageUrl: null,
        reply: "Lovely.",
        jobId: null,
        dedupe: false,
      },
    ]);
    expect(outcome).toMatchObject({ status: "answered", conversationId: NEW_CONV, saved: true });
  });

  test("an old server that answers only a reply still lands it", async () => {
    const server = chatServer([{ reply: "Lovely." }]);
    const { send, persists } = sender({ call: server.call });
    const outcome = await send.send({ ...BASE, conversationId: CONV });
    expect(persists[0]).toMatchObject({ conversationId: CONV, dedupe: false });
    expect(outcome).toMatchObject({ status: "answered", conversationId: CONV, saved: true });
  });

  test("her press is remembered for this browser until a real answer arrives", async () => {
    const timeout = new Error("Timed out");
    timeout.name = "TimeoutError";
    const server = chatServer([timeout, { reply: "Ok.", saved: true }]);
    const { send, pending } = sender({ call: server.call });
    await send.send({ ...BASE });
    expect(pending.get(USER, NOW)?.id).toBe(server.calls[0].clientRequestId);
    await send.send({ ...BASE });
    expect(pending.get(USER, NOW)).toBeNull();
  });

  test("a resend refused because its reply was delivered but not stored is never re-pressed with a new id", async () => {
    const server = chatServer([
      Object.assign(new Error("Timed out"), { name: "TimeoutError" }),
      new Error("Mila couldn't respond just now. Please try again."),
      { reply: "Ok.", saved: true },
    ]);
    const harness = sender({
      call: server.call,
      readRow: async (_userId, id) =>
        row({
          client_request_id: id,
          status: "failed",
          error_code: "persist_failed_delivered",
          completed_at: new Date(NOW).toISOString(),
        }),
    });
    const first = await harness.send.send({ ...BASE });
    if (first.status !== "lost") throw new Error("expected a lost answer");
    const second = await harness.send.send({ ...BASE, previousRequestId: first.clientRequestId });
    expect(second.status).toBe("delivered");
    await harness.send.send({ ...BASE });
    expect(server.calls[2].clientRequestId).toBe(server.calls[0].clientRequestId);
  });
});

describe("the checked write (persistExchange)", () => {
  type Op = { table: string; kind: string; payload?: unknown; filters: Record<string, unknown> };

  function fakeDb(
    fail: Partial<Record<"conversation" | "messages" | "bump" | "read", boolean>> = {},
    existing: Array<{ role: string; content: string }> = [],
  ) {
    const ops: Op[] = [];
    const db = {
      from(table: string) {
        const op: Op = { table, kind: "select", filters: {} };
        const builder = {
          insert(payload: unknown) {
            op.kind = "insert";
            op.payload = payload;
            return builder;
          },
          update(payload: unknown) {
            op.kind = "update";
            op.payload = payload;
            return builder;
          },
          select() {
            return builder;
          },
          eq(column: string, value: unknown) {
            op.filters[column] = value;
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          single() {
            return builder;
          },
          abortSignal() {
            return builder;
          },
          then(resolve: (value: unknown) => unknown, reject?: (e: unknown) => unknown) {
            ops.push(op);
            const failed =
              (table === "concierge_conversations" && op.kind === "insert" && fail.conversation) ||
              (table === "concierge_messages" && op.kind === "insert" && fail.messages) ||
              (table === "concierge_conversations" && op.kind === "update" && fail.bump) ||
              (table === "concierge_messages" && op.kind === "select" && fail.read);
            const data = failed
              ? null
              : table === "concierge_conversations" && op.kind === "insert"
                ? { id: NEW_CONV }
                : op.kind === "select"
                  ? existing
                  : null;
            return Promise.resolve({
              data,
              error: failed ? { message: "boom", code: "500" } : null,
            }).then(resolve, reject);
          },
        };
        return builder;
      },
    };
    return { db: db as unknown as ConciergeDb, ops };
  }

  const ARGS: ConciergePersistArgs = {
    userId: USER,
    conversationId: null,
    message: "   What goes   with olive?  ",
    imageUrl: PHOTO_URL,
    reply: "Cream and rust.",
    jobId: null,
    dedupe: false,
  };

  test("a new chat: creates the conversation (titled like the server) and inserts both messages", async () => {
    const { db, ops } = fakeDb();
    const outcome = await saveConciergeExchange(db, ARGS);
    expect(outcome).toEqual({
      ok: true,
      conversationId: NEW_CONV,
      created: true,
      alreadySaved: false,
    });
    const conversation = ops.find(
      (o) => o.table === "concierge_conversations" && o.kind === "insert",
    );
    expect(conversation?.payload).toEqual({ user_id: USER, title: "What goes with olive?" });
    const messages = ops.find((o) => o.table === "concierge_messages" && o.kind === "insert");
    expect(messages?.payload).toEqual([
      {
        conversation_id: NEW_CONV,
        user_id: USER,
        role: "user",
        content: ARGS.message,
        image_url: PHOTO_URL,
      },
      { conversation_id: NEW_CONV, user_id: USER, role: "assistant", content: ARGS.reply },
    ]);
  });

  test("every error is checked: a failed message insert answers not saved, with the conversation it made", async () => {
    const { db } = fakeDb({ messages: true });
    expect(await saveConciergeExchange(db, ARGS)).toEqual({
      ok: false,
      conversationId: NEW_CONV,
      created: true,
      stage: "messages",
    });
  });

  test("a failed conversation insert answers not saved and writes no messages", async () => {
    const { db, ops } = fakeDb({ conversation: true });
    expect(await saveConciergeExchange(db, ARGS)).toEqual({
      ok: false,
      conversationId: null,
      created: false,
      stage: "conversation",
    });
    expect(ops.some((o) => o.table === "concierge_messages")).toBe(false);
  });

  test("a failed bump only leaves the list order stale: the turn is saved", async () => {
    const { db } = fakeDb({ bump: true });
    const outcome = await saveConciergeExchange(db, { ...ARGS, conversationId: CONV });
    expect(outcome.ok).toBe(true);
  });

  test("dedupe: a reply already in the conversation is not written again", async () => {
    const { db, ops } = fakeDb({}, [
      { role: "assistant", content: "Cream and rust." },
      { role: "user", content: ARGS.message },
    ]);
    const outcome = await saveConciergeExchange(db, {
      ...ARGS,
      conversationId: CONV,
      dedupe: true,
    });
    expect(outcome).toEqual({ ok: true, conversationId: CONV, created: false, alreadySaved: true });
    expect(ops.some((o) => o.kind === "insert")).toBe(false);
  });

  test("dedupe: a failed read writes nothing on a guess", async () => {
    const { db, ops } = fakeDb({ read: true });
    const outcome = await saveConciergeExchange(db, {
      ...ARGS,
      conversationId: CONV,
      dedupe: true,
    });
    expect(outcome).toMatchObject({ ok: false, stage: "check" });
    expect(ops.some((o) => o.kind === "insert")).toBe(false);
  });
});

describe("the pending press and the write claims", () => {
  test("pending presses are kept per member, in storage, and forgotten after 12 h", () => {
    const storage = memoryStorage();
    const store = createConciergePendingStore(() => storage);
    store.set(USER, { id: "req-1", at: NOW });
    expect(store.get(USER, NOW)?.id).toBe("req-1");
    expect(store.get(OTHER, NOW)).toBeNull();
    expect(createConciergePendingStore(() => storage).get(USER, NOW)?.id).toBe("req-1");
    expect(store.get(USER, NOW + 12 * 3_600_000 + 1)).toBeNull();
    store.clear(USER, "req-other");
    expect(store.get(USER, NOW)?.id).toBe("req-1");
    store.clear(USER, "req-1");
    expect(store.get(USER, NOW)).toBeNull();
  });

  test("blocked storage falls back to memory", () => {
    const store = createConciergePendingStore(() => {
      throw new Error("blocked");
    });
    store.set(USER, { id: "req-1", at: NOW });
    expect(store.get(USER, NOW)?.id).toBe("req-1");
  });

  test("a write is claimed once per job until it is released", () => {
    const claims = createConciergeWriteClaims();
    expect(claims.claim("job-1")).toBe(true);
    expect(claims.claim("job-1")).toBe(false);
    claims.release("job-1");
    expect(claims.claim("job-1")).toBe(true);
    claims.done("job-1");
    expect(claims.claim("job-1")).toBe(false);
    expect(claims.isDone("job-1")).toBe(true);
  });
});

describe("what her concierge row means for the open chat", () => {
  const ctx = {
    now: NOW,
    openConversationId: null as string | null,
    ownRequestIds: [] as string[],
    busy: false,
    dismissed: [] as string[],
  };

  test("reads a stored reply, and nothing else", () => {
    expect(conciergeReplyFrom({ reply: "Hi", conversationId: CONV, saved: true })).toEqual({
      reply: "Hi",
      conversationId: CONV,
      saved: true,
    });
    expect(conciergeReplyFrom({ reply: "" })).toBeNull();
    expect(conciergeReplyFrom(null)).toBeNull();
  });

  test("migration missing: nothing is recovered", () => {
    expect(
      conciergeRecovery(
        { available: false, job: null, offer: null },
        { ...ctx, ownRequestIds: ["req-1"] },
      ),
    ).toBeNull();
  });

  test("her running turn in a new chat, matched by her own request id", () => {
    const job = row();
    expect(
      conciergeRecovery(view(job, "running"), { ...ctx, ownRequestIds: ["req-1"] }),
    ).toMatchObject({
      kind: "running",
      own: true,
    });
  });

  test("a new-chat turn that is not hers from this browser is never pulled into the open chat", () => {
    expect(conciergeRecovery(view(row(), "running"), ctx)).toBeNull();
  });

  test("a turn in the open conversation is followed, from any device", () => {
    const job = row({ input: { message: "Hi", conversationId: CONV } });
    expect(
      conciergeRecovery(view(job, "running"), { ...ctx, openConversationId: CONV }),
    ).toMatchObject({ kind: "running", own: false, target: CONV });
    expect(
      conciergeRecovery(view(job, "running"), { ...ctx, openConversationId: NEW_CONV }),
    ).toBeNull();
  });

  test("her own call in flight speaks for itself", () => {
    expect(
      conciergeRecovery(view(row(), "running"), { ...ctx, ownRequestIds: ["req-1"], busy: true }),
    ).toBeNull();
  });

  test("a turn answered live here is never shown composing again from a row not yet re-read", () => {
    const job = row({ input: { message: "Hi", conversationId: CONV } });
    expect(
      conciergeRecovery(view(job, "running"), {
        ...ctx,
        openConversationId: CONV,
        ownRequestIds: ["req-1"],
        answered: ["req-1"],
      }),
    ).toBeNull();
  });

  test("ready: the reply and where it lives", () => {
    const job = row({
      status: "succeeded",
      result: { reply: "Cream.", conversationId: NEW_CONV, saved: true },
      completed_at: new Date(NOW - 1_000).toISOString(),
    });
    expect(
      conciergeRecovery(view(job, "ready"), { ...ctx, ownRequestIds: ["req-1"] }),
    ).toMatchObject({
      kind: "ready",
      reply: "Cream.",
      saved: true,
      target: NEW_CONV,
    });
  });

  test("an empty conversation left by a failed insert is filled when she opens it", () => {
    const job = row({
      status: "succeeded",
      result: { reply: "Cream.", conversationId: NEW_CONV, saved: false },
      completed_at: new Date(NOW - 1_000).toISOString(),
    });
    expect(
      conciergeRecovery(view(job, "ready"), { ...ctx, openConversationId: NEW_CONV }),
    ).toMatchObject({ kind: "ready", saved: false, target: NEW_CONV });
  });

  test("failed: refunded or not", () => {
    const job = row({
      status: "failed",
      credit_state: "refunded",
      error_code: "ai_failed",
      completed_at: new Date(NOW - 1_000).toISOString(),
    });
    expect(
      conciergeRecovery(view(job, "failed"), { ...ctx, ownRequestIds: ["req-1"] }),
    ).toMatchObject({
      kind: "failed",
      refunded: true,
    });
  });

  test("delivered but not stored is its own state (never a failure, never re-pressed)", () => {
    const job = row({
      status: "failed",
      error_code: "persist_failed_delivered",
      completed_at: new Date(NOW - 1_000).toISOString(),
    });
    expect(conciergeRecovery(view(job, null), { ...ctx, ownRequestIds: ["req-1"] })).toMatchObject({
      kind: "delivered",
    });
    expect(
      conciergeRecovery(view(job, null), {
        ...ctx,
        ownRequestIds: ["req-1"],
        dismissed: ["job-1"],
      }),
    ).toBeNull();
    expect(
      conciergeRecovery(view(job, null), {
        ...ctx,
        ownRequestIds: ["req-1"],
        now: NOW + 13 * 3_600_000,
      }),
    ).toBeNull();
  });
});

describe("applying a finished turn", () => {
  function deps(overrides: Partial<ConciergeRecoveryDeps> = {}) {
    const events: Array<[string, ...unknown[]]> = [];
    const pressKeys = createFeaturePressKeys(ids());
    const pending = createConciergePendingStore(() => null);
    const value: ConciergeRecoveryDeps = {
      userId: USER,
      openConversationId: null,
      loadConversation: async (id) => {
        events.push(["load", id]);
        return [
          {
            role: "user",
            content: "What goes with olive?",
            image_url: null,
            created_at: new Date(NOW).toISOString(),
          },
          {
            role: "assistant",
            content: "Cream.",
            image_url: null,
            created_at: new Date(NOW + 1).toISOString(),
          },
        ];
      },
      persist: async (args) => {
        events.push(["persist", args.conversationId, args.dedupe]);
        return {
          ok: true,
          conversationId: args.conversationId ?? NEW_CONV,
          created: !args.conversationId,
          alreadySaved: false,
        };
      },
      claims: createConciergeWriteClaims(),
      pressKeys,
      pending,
      dismiss: (id) => events.push(["dismiss", id]),
      showConversation: (id, rows, requestId) => events.push(["show", id, rows.length, requestId]),
      openedConversation: (id) => events.push(["opened", id]),
      showTurn: (turn) => events.push(["turn", turn.reply, turn.save ? "unsaved" : "saved"]),
      markFailed: (turn, note) => events.push(["failed", turn.requestId, note]),
      markDelivered: (turn, note) => events.push(["delivered", turn.requestId, note]),
      refreshConversationList: () => events.push(["refresh"]),
      announce: (text) => events.push(["announce", text]),
      ...overrides,
    };
    return { value, events, pressKeys, pending };
  }

  test("a recovered new conversation calls onConversationCreated with its id", async () => {
    const job = row({
      status: "succeeded",
      result: { reply: "Cream.", conversationId: NEW_CONV, saved: true },
      completed_at: new Date(NOW).toISOString(),
    });
    const recovery = conciergeRecovery(view(job, "ready"), {
      now: NOW,
      openConversationId: null,
      ownRequestIds: ["req-1"],
      busy: false,
      dismissed: [],
    });
    if (!recovery) throw new Error("expected a recovery");
    const { value, events } = deps();
    await applyConciergeRecovery(recovery, value);
    expect(events).toEqual([
      ["load", NEW_CONV],
      ["show", NEW_CONV, 2, "req-1"],
      ["opened", NEW_CONV],
      ["dismiss", "job-1"],
      ["announce", "Mila's reply is here."],
    ]);
  });

  test("the open conversation is refetched, not switched", async () => {
    const job = row({
      input: { message: "Hi", conversationId: CONV },
      status: "succeeded",
      result: { reply: "Cream.", conversationId: CONV, saved: true },
      completed_at: new Date(NOW).toISOString(),
    });
    const recovery = conciergeRecovery(view(job, "ready"), {
      now: NOW,
      openConversationId: CONV,
      ownRequestIds: [],
      busy: false,
      dismissed: [],
    });
    if (!recovery) throw new Error("expected a recovery");
    const { value, events } = deps({ openConversationId: CONV });
    await applyConciergeRecovery(recovery, value);
    expect(events.map((e) => e[0])).toEqual(["load", "show", "dismiss", "announce"]);
  });

  test("a replayed job with saved false is written once, keyed by its job, into the server's conversation", async () => {
    const job = row({
      status: "succeeded",
      result: { reply: "Cream.", conversationId: NEW_CONV, saved: false },
      completed_at: new Date(NOW).toISOString(),
    });
    const recovery = conciergeRecovery(view(job, "ready"), {
      now: NOW,
      openConversationId: null,
      ownRequestIds: ["req-1"],
      busy: false,
      dismissed: [],
    });
    if (!recovery) throw new Error("expected a recovery");
    const harness = deps();
    await applyConciergeRecovery(recovery, harness.value);
    await applyConciergeRecovery(recovery, harness.value);
    const persisted = harness.events.filter((e) => e[0] === "persist");
    expect(persisted).toEqual([["persist", NEW_CONV, true]]);
  });

  test("a recovered turn that cannot be saved is shown with its Save button", async () => {
    const job = row({
      status: "succeeded",
      result: { reply: "Cream.", conversationId: null, saved: false },
      completed_at: new Date(NOW).toISOString(),
    });
    const recovery = conciergeRecovery(view(job, "ready"), {
      now: NOW,
      openConversationId: null,
      ownRequestIds: ["req-1"],
      busy: false,
      dismissed: [],
    });
    if (!recovery) throw new Error("expected a recovery");
    const harness = deps({
      persist: async () => ({
        ok: false,
        conversationId: null,
        created: false,
        stage: "conversation",
      }),
    });
    await applyConciergeRecovery(recovery, harness.value);
    expect(harness.events).toContainEqual(["turn", "Cream.", "unsaved"]);
    expect(harness.events).toContainEqual(["dismiss", "job-1"]);
  });

  test("failed: her bubble is marked with the failure copy, and its id is retired", async () => {
    const job = row({
      status: "failed",
      credit_state: "refunded",
      error_code: "ai_failed",
      completed_at: new Date(NOW).toISOString(),
    });
    const recovery = conciergeRecovery(view(job, "failed"), {
      now: NOW,
      openConversationId: null,
      ownRequestIds: ["req-1"],
      busy: false,
      dismissed: [],
    });
    if (!recovery) throw new Error("expected a recovery");
    const harness = deps();
    const fingerprintId = harness.pressKeys.keyFor(USER, "concierge", "fp");
    const failedJob = { ...recovery, job: { ...recovery.job, client_request_id: fingerprintId } };
    await applyConciergeRecovery(failedJob, harness.value);
    expect(harness.events).toContainEqual([
      "failed",
      fingerprintId,
      "Mila couldn't answer that. Your credit is back.",
    ]);
    expect(harness.pressKeys.keyFor(USER, "concierge", "fp")).not.toBe(fingerprintId);
  });

  test("delivered: the conversation is refreshed, nothing is shown as failed, and the id is kept", async () => {
    const job = row({
      status: "failed",
      error_code: "persist_failed_delivered",
      completed_at: new Date(NOW).toISOString(),
    });
    const recovery = conciergeRecovery(view(job, null), {
      now: NOW,
      openConversationId: null,
      ownRequestIds: ["req-1"],
      busy: false,
      dismissed: [],
    });
    if (!recovery) throw new Error("expected a recovery");
    const harness = deps();
    const id = harness.pressKeys.keyFor(USER, "concierge", "fp");
    await applyConciergeRecovery(
      { ...recovery, job: { ...recovery.job, client_request_id: id } },
      harness.value,
    );
    expect(harness.events.map((e) => e[0])).toEqual(["refresh", "delivered", "dismiss"]);
    expect(harness.pressKeys.keyFor(USER, "concierge", "fp")).toBe(id);
  });

  test("nothing is applied once the chat has gone", async () => {
    const job = row({
      status: "succeeded",
      result: { reply: "Cream.", conversationId: NEW_CONV, saved: true },
      completed_at: new Date(NOW).toISOString(),
    });
    const recovery = conciergeRecovery(view(job, "ready"), {
      now: NOW,
      openConversationId: null,
      ownRequestIds: ["req-1"],
      busy: false,
      dismissed: [],
    });
    if (!recovery) throw new Error("expected a recovery");
    const harness = deps({ alive: () => false });
    await applyConciergeRecovery(recovery, harness.value);
    expect(harness.events.some((e) => e[0] === "opened" || e[0] === "show")).toBe(false);
  });
});

describe("refetching a conversation keeps what is only on screen", () => {
  test("unsaved and failed turns stay; the recovered turn's local copy is replaced", () => {
    const fromDb = [{ id: 10, clientRequestId: undefined, failed: false, unsaved: false }];
    const local = [
      { id: 1, clientRequestId: "req-a", failed: true },
      { id: 2, clientRequestId: "req-b", unsaved: true },
      { id: 3, clientRequestId: "req-b", unsaved: true },
      { id: 4, clientRequestId: "req-c" },
      { id: 5, clientRequestId: "req-r", failed: true },
    ];
    expect(keepUnsavedTurns(fromDb, local, "req-r").map((m) => m.id)).toEqual([10, 1, 2, 3]);
  });
});
