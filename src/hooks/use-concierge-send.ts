import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { queryKeys } from "@/constants/query-keys";
import { conversationTitle } from "@/lib/concierge-title";
import { conciergeChat, type ConciergeReply } from "@/lib/concierge-chat.functions";
import {
  OFFER_WINDOW_MS,
  PERSIST_FAILED_DELIVERED,
  featureFailureCopy,
  featureJobOffer,
  type FeatureJobOffer,
} from "@/lib/feature-job-offer";
import {
  featureMutationOptions,
  featurePressKeys,
  featureRequestKey,
  featureWaitCopy,
  isLostAnswer,
  type FeatureJob,
  type createFeaturePressKeys,
} from "@/lib/queries/feature-jobs";
import { withTimeout } from "@/lib/utils";

/**
 * Concierge on the web client (P2b plan, W4): a reply she paid for is never
 * lost, a retry never charges twice and never drops her photo.
 *
 * - Each turn is sent with a request id (one per request fingerprint, kept
 *   after a lost answer, retired on a real answer) and `saveTurn: true`, so the
 *   server writes the turn into its conversation before she is answered.
 * - When the server could not save it (`saved: false`, or the migration is not
 *   applied), the client writes the pair, checking every error, once per job.
 * - Her latest concierge job row (`useFeatureJob`) brings a turn back after a
 *   reload, a closed tab or a route change: still composing, the reply, or a
 *   calm failure.
 *
 * Everything with logic lives in plain functions here (tested without a DOM);
 * `ConciergeChat` only wires them to its state.
 */

// ---------------------------------------------------------------------------
// Copy (plan section 8: C1 to C6; no em or en dashes)
// ---------------------------------------------------------------------------

export const CONCIERGE_COPY = {
  /** C1, while Mila composes and jobs are live. */
  leave: featureWaitCopy("concierge", 0, { canLeave: true }).line,
  /** C2 */
  preparing: "Preparing your photo…",
  /** C3 */
  unsaved: "Not saved to your history yet.",
  save: "Save",
  saving: "Saving…",
  saveFailed: "Still not saved. Please try again.",
  /** C6 */
  cost: "Each reply uses 1 credit.",
  /** A lost answer while jobs are not live (the plan's L8 wording). */
  slow: "Mila is taking longer than usual. Please try again in a moment.",
  uploadFailed: "Couldn't upload your photo. Please try again.",
  recovered: "Mila's reply is here.",
  delivered: "Mila answered this one. Find it in your recent chats.",
} as const;

/** The call gives up after this long: the job row then speaks for it. */
export const CONCIERGE_CALL_TIMEOUT_MS = 150_000;
/** A photo upload that hangs becomes a calm failure (her photo is kept for the retry). */
export const CONCIERGE_UPLOAD_TIMEOUT_MS = 60_000;
/** Every read and write here gives up after this long. */
export const CONCIERGE_DB_TIMEOUT_MS = 8_000;
/** How many of a conversation's newest messages are read to see whether a turn is already saved. */
export const CONCIERGE_DEDUPE_WINDOW = 20;

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export type ConciergeHistoryMessage = { role: "user" | "assistant"; content: string };

export type ConciergeCallVariables = {
  userId: string;
  clientRequestId: string;
  message: string;
  history: ConciergeHistoryMessage[];
  lookId: string | null;
  imageUrl: string | null;
  conversationId: string | null;
};

/** What the server function receives: always `saveTurn`, never the member id. */
export function conciergeCallData(variables: ConciergeCallVariables) {
  return {
    message: variables.message,
    history: variables.history,
    lookId: variables.lookId,
    imageUrl: variables.imageUrl,
    clientRequestId: variables.clientRequestId,
    conversationId: variables.conversationId,
    saveTurn: true,
  };
}

/**
 * The call got an answer that is not Mila's: a gateway page (502/503/504) or
 * any other response the app server did not write. The turn may still be
 * running, so it is a lost answer, never a refusal: the id is kept.
 */
export class ConciergeLostAnswerError extends Error {
  constructor(status: number) {
    super(`No answer from Mila (${status}).`);
    this.name = "LostAnswerError";
  }
}

// src: https://unpkg.com/@tanstack/start-client-core@1.170.34/src/client-rpc/serverFnFetcher.ts
//   (`const fetchImpl = first.fetch ?? handler`: a per-call `fetch` is used when given; a
//   response the Start server wrote carries `x-tss-serialized`, any other non-OK answer
//   becomes `new Error(await response.text())`) · @tanstack/start-client-core 1.170.34
const START_SERIALIZED = "x-tss-serialized";
const START_RAW = "x-tss-raw";

export type ConciergeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** A non-OK answer the app server did not write is a ConciergeLostAnswerError. */
export function guardConciergeFetch(
  fetchImpl: ConciergeFetch = (input, init) => fetch(input, init),
): ConciergeFetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    const ours =
      !!response.headers.get(START_SERIALIZED) || response.headers.get(START_RAW) === "true";
    if (!response.ok && !ours) throw new ConciergeLostAnswerError(response.status);
    return response;
  };
}

export const conciergeFetch = guardConciergeFetch();

/** The call ended without Mila's answer: keep the id, and let the job row decide. */
export function isConciergeLostAnswer(error: unknown): boolean {
  if (error instanceof Error && error.name === "LostAnswerError") return true;
  return isLostAnswer(error);
}

type ChatFn = (options: {
  data: ReturnType<typeof conciergeCallData>;
  fetch: ConciergeFetch;
}) => Promise<ConciergeReply>;

/** One concierge call: bounded, through the guarded fetch. */
export function callConcierge(chat: ChatFn, variables: ConciergeCallVariables) {
  return withTimeout(
    chat({ data: conciergeCallData(variables), fetch: conciergeFetch }),
    CONCIERGE_CALL_TIMEOUT_MS,
  );
}

/**
 * The concierge mutation (`["generation", "concierge"]`): never retried, never
 * paused offline, and when it settles her credits, her job rows and her
 * conversation list are refreshed, even if the chat has unmounted.
 */
export function useConciergeSend(userId: string | undefined) {
  const queryClient = useQueryClient();
  const chat = useServerFn(conciergeChat);
  const latestChat = useRef(chat);
  latestChat.current = chat;
  return useMutation(
    featureMutationOptions<ConciergeCallVariables, ConciergeReply>(
      "concierge",
      (variables) => callConcierge(latestChat.current as unknown as ChatFn, variables),
      queryClient,
      [queryKeys.conciergeConversations(userId)],
    ),
  );
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

/**
 * What the composer allows. Send and the quick prompts wait while her photo
 * is being prepared (a Send then would go without it), while a turn is being
 * sent, and while Mila composes a recovered turn (the server takes one turn
 * at a time).
 */
export function conciergeComposerState(state: {
  input: string;
  sending: boolean;
  preparing: boolean;
  composing: boolean;
}) {
  const waiting = state.sending || state.preparing || state.composing;
  return {
    sendDisabled: waiting || !state.input.trim(),
    promptsDisabled: waiting,
    attachDisabled: waiting,
    inputDisabled: state.sending,
    status: state.preparing ? CONCIERGE_COPY.preparing : null,
  };
}

// ---------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------

export type AttachmentFingerprint =
  { name: string; size: number; lastModified: number; type: string } | { url: string } | null;

/** Her photo as it was picked (so a retry after the upload is the same request), else its URL. */
export function attachmentFingerprint(
  file: File | null,
  uploadedUrl: string | null,
): AttachmentFingerprint {
  if (file) {
    return { name: file.name, size: file.size, lastModified: file.lastModified, type: file.type };
  }
  return uploadedUrl ? { url: uploadedUrl } : null;
}

/** One request: the same conversation, message, look and photo. */
export function conciergeFingerprint(request: {
  conversationId: string | null;
  message: string;
  lookId: string | null;
  attachment: AttachmentFingerprint;
}): string {
  return featureRequestKey({
    conversationId: request.conversationId,
    message: request.message,
    lookId: request.lookId,
    attachment: request.attachment,
  });
}

// ---------------------------------------------------------------------------
// Her pending press (this browser), and write claims (this tab)
// ---------------------------------------------------------------------------

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export type ConciergePendingTurn = { id: string; at: number };

const PENDING_PREFIX = "mila:concierge-pending:";

/**
 * The request id of her last unanswered concierge press, per member, in this
 * browser (memory when storage throws). A reload or a closed tab loses the
 * in-memory press keys, not this: her own turn is then still recognised by
 * its job row's `client_request_id`. Older than 12 h counts as nothing.
 */
export function createConciergePendingStore(storage: () => StorageLike | null = defaultStorage) {
  const memory = new Map<string, ConciergePendingTurn>();
  const keyOf = (userId: string) => `${PENDING_PREFIX}${userId}`;
  const parse = (raw: string): ConciergePendingTurn | null => {
    try {
      const value: unknown = JSON.parse(raw);
      if (
        value &&
        typeof value === "object" &&
        typeof (value as ConciergePendingTurn).id === "string" &&
        typeof (value as ConciergePendingTurn).at === "number"
      ) {
        return { id: (value as ConciergePendingTurn).id, at: (value as ConciergePendingTurn).at };
      }
    } catch {
      // Unreadable: nothing pending.
    }
    return null;
  };
  const read = (userId: string): ConciergePendingTurn | null => {
    try {
      const raw = storage()?.getItem(keyOf(userId));
      if (raw === "") return null;
      if (typeof raw === "string") return parse(raw);
    } catch {
      // Blocked storage: the memory copy speaks.
    }
    return memory.get(userId) ?? null;
  };
  const write = (userId: string, turn: ConciergePendingTurn | null) => {
    if (turn) memory.set(userId, turn);
    else memory.delete(userId);
    try {
      storage()?.setItem(keyOf(userId), turn ? JSON.stringify(turn) : "");
    } catch {
      // Kept in memory for this tab.
    }
  };
  return {
    /** Her pending press, judged at `now` (read when the caller decides). */
    get(userId: string, now: number): ConciergePendingTurn | null {
      const turn = read(userId);
      if (!turn || now - turn.at > OFFER_WINDOW_MS) return null;
      return turn;
    },
    set(userId: string, turn: ConciergePendingTurn) {
      write(userId, turn);
    },
    /** Forgets the pending press only if it is this one. */
    clear(userId: string, id: string) {
      if (read(userId)?.id === id) write(userId, null);
    },
  };
}
export type ConciergePendingStore = ReturnType<typeof createConciergePendingStore>;
export const conciergePendingTurns = createConciergePendingStore();

/**
 * Client writes of a turn the server could not save, claimed per job id in
 * this tab, so the live answer and a recovery never write the same turn twice.
 */
export function createConciergeWriteClaims() {
  const writing = new Set<string>();
  const written = new Set<string>();
  return {
    claim(jobId: string): boolean {
      if (writing.has(jobId) || written.has(jobId)) return false;
      writing.add(jobId);
      return true;
    },
    release(jobId: string) {
      writing.delete(jobId);
    },
    done(jobId: string) {
      writing.delete(jobId);
      written.add(jobId);
    },
    isDone: (jobId: string) => written.has(jobId),
  };
}
export type ConciergeWriteClaims = ReturnType<typeof createConciergeWriteClaims>;
export const conciergeWriteClaims = createConciergeWriteClaims();

export type FeaturePressKeys = ReturnType<typeof createFeaturePressKeys>;

// ---------------------------------------------------------------------------
// The checked client write (persistExchange)
// ---------------------------------------------------------------------------

export type ConciergeDb = Pick<SupabaseClient<Database>, "from">;

export type ConciergePersistArgs = {
  userId: string;
  /** Where the turn goes; null opens a new conversation. */
  conversationId: string | null;
  message: string;
  imageUrl: string | null;
  reply: string;
  /** The job this turn came from: its write is claimed once per tab. */
  jobId: string | null;
  /** Read the conversation first and skip the write when the reply is already there. */
  dedupe: boolean;
};

export type ConciergePersistOutcome =
  | { ok: true; conversationId: string; created: boolean; alreadySaved: boolean }
  | {
      ok: false;
      conversationId: string | null;
      created: boolean;
      stage: "conversation" | "check" | "messages" | "busy";
    };

function bounded() {
  return AbortSignal.timeout(CONCIERGE_DB_TIMEOUT_MS);
}

/**
 * Writes one turn (her message and Mila's reply) into its conversation as
 * her, checking every error. A failed conversation or message write answers
 * `ok: false` (with the conversation it did create), so the reply bubble can
 * say "Not saved to your history yet." and offer Save. A failed `updated_at`
 * bump only leaves the list order stale.
 */
export async function saveConciergeExchange(
  db: ConciergeDb,
  args: ConciergePersistArgs,
): Promise<ConciergePersistOutcome> {
  let conversationId = args.conversationId;
  let created = false;
  try {
    if (conversationId === null) {
      // src: https://supabase.com/docs/reference/javascript/abortsignal · @supabase/postgrest-js 2.110.0
      const { data, error } = await db
        .from("concierge_conversations")
        .insert({ user_id: args.userId, title: conversationTitle(args.message) })
        .select("id")
        .abortSignal(bounded())
        .single();
      if (error || !data) {
        console.warn("[concierge] couldn't save the conversation:", error?.message);
        return { ok: false, conversationId: null, created: false, stage: "conversation" };
      }
      conversationId = data.id;
      created = true;
    } else if (args.dedupe) {
      const { data, error } = await db
        .from("concierge_messages")
        .select("role,content")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(CONCIERGE_DEDUPE_WINDOW)
        .abortSignal(bounded());
      if (error) {
        console.warn("[concierge] couldn't check the conversation:", error.message);
        return { ok: false, conversationId, created, stage: "check" };
      }
      if ((data ?? []).some((m) => m.role === "assistant" && m.content === args.reply)) {
        return { ok: true, conversationId, created, alreadySaved: true };
      }
    }

    const { error: messagesError } = await db
      .from("concierge_messages")
      .insert([
        {
          conversation_id: conversationId,
          user_id: args.userId,
          role: "user",
          content: args.message,
          image_url: args.imageUrl,
        },
        {
          conversation_id: conversationId,
          user_id: args.userId,
          role: "assistant",
          content: args.reply,
        },
      ])
      .abortSignal(bounded());
    if (messagesError) {
      console.warn("[concierge] couldn't save the messages:", messagesError.message);
      return { ok: false, conversationId, created, stage: "messages" };
    }

    const { error: bumpError } = await db
      .from("concierge_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", args.userId)
      .abortSignal(bounded());
    if (bumpError) console.warn("[concierge] couldn't bump the conversation:", bumpError.message);
    return { ok: true, conversationId, created, alreadySaved: false };
  } catch (err) {
    console.warn("[concierge] couldn't save the turn:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      conversationId,
      created,
      stage: conversationId === null ? "conversation" : "messages",
    };
  }
}

// ---------------------------------------------------------------------------
// Sending a turn
// ---------------------------------------------------------------------------

export type ConciergeTurnInput = {
  userId: string;
  message: string;
  history: ConciergeHistoryMessage[];
  lookId: string | null;
  /** The open conversation, or null on a new chat. */
  conversationId: string | null;
  /** Her photo as picked, kept for a retry. */
  file: File | null;
  /** Her photo once uploaded: reused by a retry, never uploaded twice. */
  uploadedUrl: string | null;
  /** The id this message was sent with before (a retry). */
  previousRequestId?: string | null;
};

export type ConciergeTurnHooks = {
  onUploaded?: (url: string) => void;
  onRequestId?: (id: string) => void;
};

export type ConciergeTurnOutcome =
  | { status: "busy" }
  | {
      status: "answered";
      reply: string;
      jobId: string | null;
      clientRequestId: string;
      uploadedUrl: string | null;
      /** Where the turn lives now (null only when nothing could be saved anywhere). */
      conversationId: string | null;
      saved: boolean;
      savedBy: "server" | "client" | null;
      /** What Save retries, when the turn is not saved yet. */
      save: ConciergePersistArgs | null;
    }
  | { status: "lost"; error: unknown; clientRequestId: string; uploadedUrl: string | null }
  | {
      status: "refused";
      error: unknown;
      stage: "upload" | "call";
      clientRequestId: string | null;
      uploadedUrl: string | null;
    }
  | { status: "delivered"; job: FeatureJob; clientRequestId: string; uploadedUrl: string | null };

export type ConciergeSenderDeps = {
  call: (variables: ConciergeCallVariables) => Promise<ConciergeReply>;
  upload: (userId: string, file: File) => Promise<string>;
  persist: (args: ConciergePersistArgs) => Promise<ConciergePersistOutcome>;
  /** Her newest concierge row for a request id (bounded), or null. */
  readRow?: (userId: string, clientRequestId: string) => Promise<FeatureJob | null>;
  pressKeys?: FeaturePressKeys;
  pending?: ConciergePendingStore;
  claims?: ConciergeWriteClaims;
  now?: () => number;
};

/**
 * Sends turns one at a time (a second send while one is in flight answers
 * `busy` and sends nothing).
 * - The photo is uploaded once; a retry reuses the URL, or uploads the kept file.
 * - One request id per request fingerprint: kept after a lost answer (a
 *   timeout, a dropped connection, a gateway page), retired on a real answer.
 * - A resend refused because its reply was delivered but not stored keeps its
 *   id: it is never re-pressed under a new one.
 * - `saved: false` (or an old server): the client writes the turn once.
 */
export function createConciergeSender(deps: ConciergeSenderDeps) {
  const keys = deps.pressKeys ?? featurePressKeys;
  const pending = deps.pending ?? conciergePendingTurns;
  const claims = deps.claims ?? conciergeWriteClaims;
  const now = deps.now ?? Date.now;
  let busy = false;

  async function writeOnce(args: ConciergePersistArgs): Promise<ConciergePersistOutcome> {
    const id = args.jobId;
    if (id && !claims.claim(id)) {
      return claims.isDone(id) && args.conversationId
        ? { ok: true, conversationId: args.conversationId, created: false, alreadySaved: true }
        : { ok: false, conversationId: args.conversationId, created: false, stage: "busy" };
    }
    const outcome = await deps.persist(args);
    if (id) {
      if (outcome.ok) claims.done(id);
      else claims.release(id);
    }
    return outcome;
  }

  async function run(
    input: ConciergeTurnInput,
    hooks: ConciergeTurnHooks,
  ): Promise<ConciergeTurnOutcome> {
    let uploadedUrl = input.uploadedUrl;
    if (!uploadedUrl && input.file) {
      try {
        uploadedUrl = await deps.upload(input.userId, input.file);
      } catch (error) {
        // Nothing was sent, so nothing was charged; her photo is kept.
        return { status: "refused", error, stage: "upload", clientRequestId: null, uploadedUrl };
      }
      hooks.onUploaded?.(uploadedUrl);
    }

    const fingerprint = conciergeFingerprint({
      conversationId: input.conversationId,
      message: input.message,
      lookId: input.lookId,
      attachment: attachmentFingerprint(input.file, uploadedUrl),
    });
    const clientRequestId = keys.keyFor(input.userId, "concierge", fingerprint);
    const resend = !!input.previousRequestId && input.previousRequestId === clientRequestId;
    hooks.onRequestId?.(clientRequestId);
    pending.set(input.userId, { id: clientRequestId, at: now() });

    let answer: ConciergeReply;
    try {
      answer = await deps.call({
        userId: input.userId,
        clientRequestId,
        message: input.message,
        history: input.history,
        lookId: input.lookId,
        imageUrl: uploadedUrl,
        conversationId: input.conversationId,
      });
    } catch (error) {
      if (isConciergeLostAnswer(error)) {
        return { status: "lost", error, clientRequestId, uploadedUrl };
      }
      if (resend && deps.readRow) {
        const row = await deps.readRow(input.userId, clientRequestId).catch(() => null);
        if (
          row &&
          row.client_request_id === clientRequestId &&
          row.status === "failed" &&
          row.error_code === PERSIST_FAILED_DELIVERED
        ) {
          pending.clear(input.userId, clientRequestId);
          return { status: "delivered", job: row, clientRequestId, uploadedUrl };
        }
      }
      keys.retire(input.userId, "concierge", clientRequestId);
      pending.clear(input.userId, clientRequestId);
      return { status: "refused", error, stage: "call", clientRequestId, uploadedUrl };
    }

    keys.retire(input.userId, "concierge", clientRequestId);
    pending.clear(input.userId, clientRequestId);
    const jobId = answer.jobId ?? null;
    const base = {
      status: "answered" as const,
      reply: answer.reply,
      jobId,
      clientRequestId,
      uploadedUrl,
    };

    if (answer.saved === true) {
      return {
        ...base,
        conversationId: answer.conversationId ?? input.conversationId,
        saved: true,
        savedBy: "server",
        save: null,
      };
    }

    // The server could not save it (or predates saving): the client writes it once,
    // into the conversation the server created when it did create one.
    const target = answer.conversationId ?? input.conversationId;
    const args: ConciergePersistArgs = {
      userId: input.userId,
      conversationId: target,
      message: input.message,
      imageUrl: uploadedUrl,
      reply: answer.reply,
      jobId,
      dedupe: jobId !== null && target !== null,
    };
    const written = await writeOnce(args);
    if (written.ok) {
      return {
        ...base,
        conversationId: written.conversationId,
        saved: true,
        savedBy: "client",
        save: null,
      };
    }
    if (written.stage === "busy") {
      // Another path in this tab is writing this very turn.
      return { ...base, conversationId: target, saved: true, savedBy: "client", save: null };
    }
    const conversationId = written.conversationId ?? target;
    return {
      ...base,
      conversationId,
      saved: false,
      savedBy: null,
      save: { ...args, conversationId, dedupe: conversationId !== null },
    };
  }

  return {
    get busy() {
      return busy;
    },
    async send(
      input: ConciergeTurnInput,
      hooks: ConciergeTurnHooks = {},
    ): Promise<ConciergeTurnOutcome> {
      if (busy) return { status: "busy" };
      busy = true;
      try {
        return await run(input, hooks);
      } finally {
        busy = false;
      }
    },
    /** Save: retries the write only. No chat call, no credit. */
    saveAgain(args: ConciergePersistArgs): Promise<ConciergePersistOutcome> {
      return writeOnce({ ...args, dedupe: args.conversationId !== null });
    },
  };
}
export type ConciergeSender = ReturnType<typeof createConciergeSender>;

// ---------------------------------------------------------------------------
// Recovery: what her concierge row means for the open chat
// ---------------------------------------------------------------------------

export type StoredConciergeReply = { reply: string; conversationId: string | null; saved: boolean };

/** A stored reply (`generation_jobs.result`), checked; null for anything else. */
export function conciergeReplyFrom(result: unknown): StoredConciergeReply | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const value = result as Record<string, unknown>;
  if (typeof value.reply !== "string" || value.reply.length === 0) return null;
  return {
    reply: value.reply,
    conversationId:
      typeof value.conversationId === "string" && value.conversationId.length > 0
        ? value.conversationId
        : null,
    saved: value.saved === true,
  };
}

type RecoveryBase = {
  job: FeatureJob;
  /** Her own press from this browser. */
  own: boolean;
  /** The conversation the turn belongs to, when known. */
  target: string | null;
};

export type ConciergeRecovery =
  | (RecoveryBase & { kind: "running" })
  | (RecoveryBase & { kind: "ready"; reply: string; saved: boolean })
  | (RecoveryBase & { kind: "failed"; refunded: boolean })
  | (RecoveryBase & { kind: "delivered" });

export type ConciergeRecoveryView = {
  available: boolean;
  job: FeatureJob | null;
  offer: FeatureJobOffer | null;
};

export type ConciergeRecoveryContext = {
  /** Now, read when the caller renders. */
  now: number;
  openConversationId: string | null;
  /** Request ids of her presses from this browser (on screen, and her pending press). */
  ownRequestIds: readonly string[];
  /** Her own call is in flight here: the live answer speaks for it. */
  busy: boolean;
  dismissed: readonly string[];
  /** Request ids answered live here: their rows have nothing more to say. */
  answered?: readonly string[];
};

/**
 * Ties her latest concierge row to the open chat by linkage only:
 * - the row's conversation is the open one (from any device), or
 * - it is her own press from this browser (its request id) for a new chat,
 *   and the open chat is a new one.
 * Anything else stays where it is (its conversation, in Recents).
 */
export function conciergeRecovery(
  view: ConciergeRecoveryView,
  ctx: ConciergeRecoveryContext,
): ConciergeRecovery | null {
  const job = view.job;
  if (ctx.busy || !view.available || !job) return null;
  // Answered live: a cached row not yet re-read must not show it composing again.
  if (ctx.answered?.includes(job.client_request_id)) return null;
  const stored = job.status === "succeeded" ? conciergeReplyFrom(job.result) : null;
  const target = stored?.conversationId ?? job.link.conversationId;
  const own = ctx.ownRequestIds.includes(job.client_request_id);
  const matched =
    (target !== null && target === ctx.openConversationId) ||
    (own && ctx.openConversationId === null && job.link.conversationId === null);
  if (!matched) return null;

  const base: RecoveryBase = { job, own, target };
  if (view.offer === "running") return { ...base, kind: "running" };
  if (view.offer === "ready") {
    return stored ? { ...base, kind: "ready", reply: stored.reply, saved: stored.saved } : null;
  }
  if (view.offer === "failed" || view.offer === "empty") {
    return { ...base, kind: "failed", refunded: job.credit_state === "refunded" };
  }
  if (job.status === "failed" && job.error_code === PERSIST_FAILED_DELIVERED) {
    // Delivered and charged, but not stored. The same window and dismissals as any offer.
    const inWindow = featureJobOffer(
      { ...job, error_code: null },
      { now: ctx.now, dismissed: ctx.dismissed },
    );
    return inWindow ? { ...base, kind: "delivered" } : null;
  }
  return null;
}

export type ConciergeMessageRow = {
  role: string;
  content: string;
  image_url: string | null;
  created_at: string;
};

export type ConciergeTurnView = {
  requestId: string;
  message: string | null;
  imageUrl: string | null;
};

export type ConciergeRecoveryDeps = {
  userId: string;
  openConversationId: string | null;
  /** The conversation's messages, read as her (bounded); null when the read failed. */
  loadConversation: (conversationId: string) => Promise<ConciergeMessageRow[] | null>;
  persist: (args: ConciergePersistArgs) => Promise<ConciergePersistOutcome>;
  claims?: ConciergeWriteClaims;
  pressKeys?: FeaturePressKeys;
  pending?: ConciergePendingStore;
  dismiss: (jobId: string) => void;
  /** Show this conversation's messages (the recovered turn's local copy is replaced). */
  showConversation: (
    conversationId: string,
    rows: ConciergeMessageRow[],
    recoveredRequestId: string,
  ) => void;
  /** The open chat was a new one: it is now this conversation (`onConversationCreated`). */
  openedConversation: (conversationId: string) => void;
  /** Show the turn on screen as is (with Save when `save` is given). */
  showTurn: (
    turn: ConciergeTurnView & { reply: string; save: ConciergePersistArgs | null },
  ) => void;
  markFailed: (turn: ConciergeTurnView, note: string) => void;
  markDelivered: (turn: ConciergeTurnView, note: string) => void;
  refreshConversationList: () => void;
  /** The polite live region. */
  announce: (text: string) => void;
  /** False once the chat has unmounted: nothing more is shown. */
  alive?: () => boolean;
};

/**
 * Lands a finished turn once (the caller runs it once per job id):
 * - ready: writes it once if the server could not (keyed by its job), then
 *   shows its conversation, switching a new chat to it;
 * - failed: marks her bubble with the failure copy, and retires its id;
 * - delivered but not stored: refreshes, never shown as a failure, and the id
 *   is kept (never re-pressed under a new one).
 * Then the job is dismissed so it is never offered again.
 */
export async function applyConciergeRecovery(
  recovery: ConciergeRecovery,
  deps: ConciergeRecoveryDeps,
): Promise<void> {
  if (recovery.kind === "running") return;
  const alive = deps.alive ?? (() => true);
  const claims = deps.claims ?? conciergeWriteClaims;
  const keys = deps.pressKeys ?? featurePressKeys;
  const pending = deps.pending ?? conciergePendingTurns;
  const { job } = recovery;
  const turn: ConciergeTurnView = {
    requestId: job.client_request_id,
    message: job.link.message,
    imageUrl: job.link.imageUrl,
  };
  const finish = () => {
    deps.dismiss(job.id);
    pending.clear(deps.userId, job.client_request_id);
  };

  const show = async (conversationId: string): Promise<boolean> => {
    const rows = await deps.loadConversation(conversationId);
    if (!alive() || !rows) return false;
    deps.showConversation(conversationId, rows, job.client_request_id);
    if (deps.openConversationId === null) deps.openedConversation(conversationId);
    return true;
  };

  if (recovery.kind === "failed") {
    deps.markFailed(turn, featureFailureCopy("concierge", recovery.refunded));
    keys.retire(deps.userId, "concierge", job.client_request_id);
    finish();
    return;
  }

  if (recovery.kind === "delivered") {
    const shown = recovery.target ? await show(recovery.target) : false;
    if (!alive()) return;
    if (!shown) {
      deps.refreshConversationList();
      deps.markDelivered(turn, CONCIERGE_COPY.delivered);
    }
    finish();
    return;
  }

  let target = recovery.target;
  if (!recovery.saved && turn.message && claims.claim(job.id)) {
    const args: ConciergePersistArgs = {
      userId: deps.userId,
      conversationId: target,
      message: turn.message,
      imageUrl: turn.imageUrl,
      reply: recovery.reply,
      jobId: job.id,
      dedupe: target !== null,
    };
    const written = await deps.persist(args);
    if (written.ok) {
      claims.done(job.id);
      target = written.conversationId;
    } else {
      claims.release(job.id);
      if (!alive()) return;
      const conversationId = written.conversationId ?? target;
      deps.showTurn({
        ...turn,
        reply: recovery.reply,
        save: { ...args, conversationId, dedupe: conversationId !== null },
      });
      finish();
      deps.announce(CONCIERGE_COPY.recovered);
      return;
    }
  }
  if (!alive()) return;

  const shown = target ? await show(target) : false;
  if (!alive()) return;
  if (!shown) deps.showTurn({ ...turn, reply: recovery.reply, save: null });
  finish();
  deps.announce(CONCIERGE_COPY.recovered);
}

/**
 * A refetched conversation, plus what exists only on screen: turns not saved
 * yet and turns that failed. The recovered turn's own local copy gives way to
 * the stored one.
 */
export function keepUnsavedTurns<
  T extends { clientRequestId?: string; failed?: boolean; unsaved?: boolean },
>(fromDb: T[], local: T[], recoveredRequestId: string | null): T[] {
  return [
    ...fromDb,
    ...local.filter(
      (m) =>
        (m.failed || m.unsaved) &&
        (recoveredRequestId === null || m.clientRequestId !== recoveredRequestId),
    ),
  ];
}
