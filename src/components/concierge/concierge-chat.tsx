import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Send,
  Sparkles,
  RotateCcw,
  X,
  Wand2,
  ChevronDown,
  ChevronUp,
  Mic,
  ImagePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UpgradeSlotsDialog } from "@/components/dashboard/upgrade-slots-dialog";
import { isInsufficientCreditsError } from "@/lib/credits";
import type { ConciergeLook } from "@/hooks/use-concierge";
import { useAuth } from "@/hooks/use-auth";
import { useFeatureJob } from "@/hooks/use-feature-job";
import {
  CONCIERGE_COPY,
  CONCIERGE_DB_TIMEOUT_MS,
  CONCIERGE_UPLOAD_TIMEOUT_MS,
  applyConciergeRecovery,
  conciergeComposerState,
  conciergePendingTurns,
  conciergeRecovery,
  createConciergeSender,
  keepUnsavedTurns,
  saveConciergeExchange,
  useConciergeSend,
  type ConciergeMessageRow,
  type ConciergePersistArgs,
  type ConciergeRecoveryDeps,
  type ConciergeTurnOutcome,
  type ConciergeTurnView,
} from "@/hooks/use-concierge-send";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import {
  featureClock,
  featureDismissals,
  featureJobKeys,
  latestFeatureJobQueryOptions,
  type FeatureJob,
  type FeatureJobState,
} from "@/lib/queries/feature-jobs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn, errorMessage, withTimeout } from "@/lib/utils";
import { prepareImageForUpload } from "@/lib/prepare-image-for-upload";
import type { Msg } from "@/components/concierge/types";
import { LookThumbnail } from "@/components/concierge/look-thumbnail";
import { MessageBubble } from "@/components/concierge/message-bubble";

const GENERAL_PROMPTS = [
  "Build an outfit for today",
  "Which neutrals suit my palette?",
  "Help me plan a capsule wardrobe",
  "What should I wear to a dinner?",
  "Suggest an easy beauty look",
];

const ATTACHMENT_PROMPTS = [
  "What do you think of this?",
  "How would you style this?",
  "Does this suit my palette?",
  "What occasions fit this piece?",
  "What would you pair with it?",
];

const ANCHORED_PROMPTS = [
  "What would you change?",
  "Suggest shoes and accessories",
  "Make this more polished",
  "Adapt this for evening",
  "Does this suit my palette?",
];

type ArchiveItem = { id: string; image_url: string | null; title: string };

const ARCHIVE_OPEN_KEY = "concierge-archive-open";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

const SpeechRecognitionCtor =
  typeof window !== "undefined"
    ? (((window as unknown as Record<string, unknown>).SpeechRecognition as
        (new () => SpeechRecognitionLike) | undefined) ??
      ((window as unknown as Record<string, unknown>).webkitSpeechRecognition as
        (new () => SpeechRecognitionLike) | undefined))
    : undefined;

function outfitTitle(raw: unknown): string {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    const headline = (v as { outfit?: { headline?: unknown } } | null)?.outfit?.headline;
    return typeof headline === "string" ? headline : "Saved Look";
  } catch {
    return "Saved Look";
  }
}

let nextMsgId = 1;

/** A conversation's messages as stored, bounded; null when the read failed. */
async function readConversation(conversationId: string): Promise<ConciergeMessageRow[] | null> {
  try {
    // src: https://supabase.com/docs/reference/javascript/abortsignal · @supabase/postgrest-js 2.110.0
    const { data, error } = await supabase
      .from("concierge_messages")
      .select("role,content,image_url,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at")
      .order("role", { ascending: false })
      .abortSignal(AbortSignal.timeout(CONCIERGE_DB_TIMEOUT_MS));
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

function toMessages(rows: ConciergeMessageRow[]): Msg[] {
  return rows.map((m) => ({
    id: nextMsgId++,
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
    ts: new Date(m.created_at).getTime(),
    imageUrl: m.image_url ?? undefined,
  }));
}

/** Her photo in her own `outfits/<userId>/` folder: the URL Mila is shown. */
async function uploadPhoto(userId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await withTimeout(
    supabase.storage.from("outfits").upload(path, file, { contentType: file.type || "image/jpeg" }),
    CONCIERGE_UPLOAD_TIMEOUT_MS,
  );
  if (error) throw error;
  return supabase.storage.from("outfits").getPublicUrl(path).data.publicUrl;
}

/** Her newest concierge row, read now (one bounded read), when it is this request's. */
async function readConciergeRow(
  queryClient: QueryClient,
  userId: string,
  clientRequestId: string,
): Promise<FeatureJob | null> {
  const state = await queryClient.fetchQuery({
    ...latestFeatureJobQueryOptions(userId, "concierge"),
    staleTime: 0,
    retry: false,
  });
  return state.status === "ready" && state.job?.client_request_id === clientRequestId
    ? state.job
    : null;
}

interface ConciergeChatProps {
  look: ConciergeLook | null;
  onSelectLook: (look: ConciergeLook) => void;
  initialConversationId?: string | null;
  onConversationCreated?: (id: string) => void;
}

export function ConciergeChat({
  look,
  onSelectLook,
  initialConversationId = null,
  onConversationCreated,
}: ConciergeChatProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const [conversationId, setConversationIdState] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // True from the moment the call is sent (after any upload): the job exists from here.
  const [calling, setCalling] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [savingIds, setSavingIds] = useState<number[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [creditPaywallOpen, setCreditPaywallOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLookIdRef = useRef<string | null>(look?.lookId ?? null);
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(
    () => typeof localStorage === "undefined" || localStorage.getItem(ARCHIVE_OPEN_KEY) !== "0",
  );

  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationBaseRef = useRef("");
  const [attachment, setAttachment] = useState<{ file: File; preview: string } | null>(null);
  const attachmentRef = useRef(attachment);
  attachmentRef.current = attachment;
  const attachRef = useRef<HTMLInputElement>(null);

  // Her photo per message, kept so a retry sends it again instead of dropping it.
  const keptFiles = useRef(new Map<number, File>());
  // What Save retries, per reply that is not saved yet.
  const unsavedTurns = useRef(new Map<number, ConciergePersistArgs>());
  // Every photo preview this chat made; a sent photo's preview stays on its bubble.
  const previewUrls = useRef(new Set<string>());
  const mounted = useRef(true);
  const appliedJobs = useRef(new Set<string>());

  const sendTurn = useConciergeSend(userId);
  const mutateRef = useRef(sendTurn.mutateAsync);
  mutateRef.current = sendTurn.mutateAsync;
  const [sender] = useState(() =>
    createConciergeSender({
      call: (variables) => mutateRef.current(variables),
      upload: uploadPhoto,
      persist: (args) => saveConciergeExchange(supabase, args),
      readRow: (uid, id) => readConciergeRow(queryClient, uid, id),
    }),
  );

  const jobView = useFeatureJob(userId, "concierge", { enabled: !!userId, inFlight: sending });
  const jobsState = userId
    ? queryClient.getQueryData<FeatureJobState>(featureJobKeys.latest(userId, "concierge"))
    : undefined;
  // The job rows answer: her turn is kept by the server even if she leaves.
  const jobsLive = jobsState?.status === "ready";
  const jobsLiveRef = useRef(jobsLive);
  jobsLiveRef.current = jobsLive;
  const dismissRef = useRef(jobView.dismiss);
  dismissRef.current = jobView.dismiss;
  const onCreatedRef = useRef(onConversationCreated);
  onCreatedRef.current = onConversationCreated;

  // Judged now, at render: her own presses on screen plus her pending press in this browser.
  const pendingTurn = userId ? conciergePendingTurns.get(userId, Date.now()) : null;
  const ownRequestIds = messages
    .map((m) => m.clientRequestId)
    .filter((id): id is string => typeof id === "string");
  if (pendingTurn) ownRequestIds.push(pendingTurn.id);
  // A reply on screen with its request id: that turn is answered here.
  const answeredRequestIds = messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.clientRequestId)
    .filter((id): id is string => typeof id === "string");
  const recovery = conciergeRecovery(jobView, {
    now: featureClock.now(),
    openConversationId: conversationId,
    ownRequestIds,
    busy: sending,
    dismissed: userId ? featureDismissals.get(userId) : [],
    answered: answeredRequestIds,
  });
  const composing = recovery?.kind === "running";
  const recoveringRequestId = composing ? recovery.job.client_request_id : null;
  const pendingBubble: Msg | null =
    composing &&
    recovery.job.link.message &&
    !messages.some((m) => m.clientRequestId === recovery.job.client_request_id)
      ? {
          id: -1,
          role: "user",
          content: recovery.job.link.message,
          ts: Date.parse(recovery.job.created_at) || Date.now(),
          imageUrl: recovery.job.link.imageUrl ?? undefined,
          clientRequestId: recovery.job.client_request_id,
        }
      : null;
  const canLeave = jobsLive && (calling || composing);
  const composer = conciergeComposerState({ input, sending, preparing, composing });

  const setConversation = useCallback((id: string | null) => {
    conversationIdRef.current = id;
    setConversationIdState(id);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const urls = previewUrls.current;
    return () => {
      mounted.current = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  function discardAttachment() {
    const current = attachmentRef.current;
    if (current) {
      URL.revokeObjectURL(current.preview);
      previewUrls.current.delete(current.preview);
    }
    setAttachment(null);
  }

  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    if (!SpeechRecognitionCtor) return;
    const rec = new SpeechRecognitionCtor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    dictationBaseRef.current = input.trim() ? input.trim() + " " : "";
    rec.onresult = (e) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setInput(dictationBaseRef.current + transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  useEffect(() => () => recognitionRef.current?.stop(), []);

  useEffect(() => {
    if (!initialConversationId || conversationIdRef.current === initialConversationId) return;
    let cancelled = false;
    void readConversation(initialConversationId).then((rows) => {
      if (cancelled) return;
      if (!rows) {
        setLoadFailed(true);
        return;
      }
      setLoadFailed(false);
      setConversation(initialConversationId);
      setMessages(toMessages(rows));
    });
    return () => {
      cancelled = true;
    };
  }, [initialConversationId, loadAttempt, setConversation]);

  /** How a finished turn lands on this chat (see applyConciergeRecovery). */
  function recoveryDeps(uid: string): ConciergeRecoveryDeps {
    const userBubble = (turn: ConciergeTurnView, changes: Partial<Msg>): Msg | null =>
      turn.message
        ? {
            id: nextMsgId++,
            role: "user",
            content: turn.message,
            ts: Date.now(),
            imageUrl: turn.imageUrl ?? undefined,
            uploadedUrl: turn.imageUrl ?? undefined,
            clientRequestId: turn.requestId,
            ...changes,
          }
        : null;
    const markHers = (turn: ConciergeTurnView, changes: Partial<Msg>) => {
      const fresh = userBubble(turn, changes);
      setMessages((prev) => {
        const isHers = (m: Msg) => m.role === "user" && m.clientRequestId === turn.requestId;
        if (prev.some(isHers)) return prev.map((m) => (isHers(m) ? { ...m, ...changes } : m));
        return fresh ? [...prev, fresh] : prev;
      });
    };
    return {
      userId: uid,
      openConversationId: conversationIdRef.current,
      loadConversation: readConversation,
      persist: (args) => saveConciergeExchange(supabase, args),
      dismiss: (jobId) => dismissRef.current(jobId),
      showConversation: (id, rows, requestId) => {
        const stored = toMessages(rows);
        setConversation(id);
        setLoadFailed(false);
        setMessages((prev) => keepUnsavedTurns(stored, prev, requestId));
      },
      openedConversation: (id) => {
        if (mounted.current) onCreatedRef.current?.(id);
      },
      showTurn: (turn) => {
        const unsaved = !!turn.save;
        const fresh = userBubble(turn, { unsaved });
        const replyId = nextMsgId++;
        if (turn.save) unsavedTurns.current.set(replyId, turn.save);
        setMessages((prev) => {
          const isHers = (m: Msg) => m.role === "user" && m.clientRequestId === turn.requestId;
          const mine = prev.some(isHers)
            ? prev.map((m) =>
                isHers(m) ? { ...m, failed: false, failedNote: undefined, unsaved } : m,
              )
            : fresh
              ? [...prev, fresh]
              : prev;
          return [
            ...mine,
            {
              id: replyId,
              role: "assistant",
              content: turn.reply,
              ts: Date.now(),
              clientRequestId: turn.requestId,
              unsaved,
            },
          ];
        });
      },
      markFailed: (turn, note) =>
        markHers(turn, { failed: true, failedNote: note, note: undefined }),
      markDelivered: (turn, note) => markHers(turn, { failed: false, failedNote: undefined, note }),
      refreshConversationList: () =>
        void queryClient.invalidateQueries({ queryKey: queryKeys.conciergeConversations(uid) }),
      announce: (text) => setAnnouncement(text),
      alive: () => mounted.current,
    };
  }
  const recoveryDepsRef = useRef(recoveryDeps);
  recoveryDepsRef.current = recoveryDeps;

  // A finished turn of hers (or of the open conversation) lands once.
  const latestRecovery = useRef(recovery);
  latestRecovery.current = recovery;
  const finishedKey =
    recovery && recovery.kind !== "running" ? `${recovery.kind}:${recovery.job.id}` : null;
  useEffect(() => {
    const current = latestRecovery.current;
    if (!finishedKey || !current || current.kind === "running" || !userId) return;
    if (appliedJobs.current.has(current.job.id)) return;
    appliedJobs.current.add(current.job.id);
    void applyConciergeRecovery(current, recoveryDepsRef.current(userId));
  }, [finishedKey, userId]);

  function toggleArchive() {
    setArchiveOpen((v) => {
      localStorage.setItem(ARCHIVE_OPEN_KEY, v ? "0" : "1");
      return !v;
    });
  }

  useEffect(() => {
    if (look || !user) return;
    let cancelled = false;
    supabase
      .from("outfits")
      .select("id,image_url,analysis_result")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setArchive(
          data.map((o) => ({
            id: o.id,
            image_url: o.image_url,
            title: outfitTitle(o.analysis_result),
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [look, user]);

  useEffect(() => {
    const id = look?.lookId ?? null;
    if (id && id !== prevLookIdRef.current) setMessages([]);
    if (id) prevLookIdRef.current = id;
  }, [look?.lookId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, composing]);

  const quickPrompts = attachment ? ATTACHMENT_PROMPTS : look ? ANCHORED_PROMPTS : GENERAL_PROMPTS;

  /**
   * Save: retries writing a reply that is shown but not saved yet. The write
   * only: no chat call, no credit. Every error is checked.
   */
  async function persistExchange(replyId: number) {
    const stored = unsavedTurns.current.get(replyId);
    if (!stored || savingIds.includes(replyId)) return;
    const openAtSave = conversationIdRef.current;
    // A turn from a new chat goes into the conversation this chat has since become.
    const args = { ...stored, conversationId: stored.conversationId ?? openAtSave };
    const requestId = messages.find((m) => m.id === replyId)?.clientRequestId;
    setSavingIds((ids) => [...ids, replyId]);
    try {
      const outcome = await sender.saveAgain(args);
      if (!outcome.ok) {
        if (outcome.conversationId) {
          unsavedTurns.current.set(replyId, { ...args, conversationId: outcome.conversationId });
        }
        toast.error(CONCIERGE_COPY.saveFailed);
        return;
      }
      unsavedTurns.current.delete(replyId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === replyId || (requestId && m.clientRequestId === requestId)
            ? { ...m, unsaved: false }
            : m,
        ),
      );
      if (openAtSave === null && conversationIdRef.current === null) {
        setConversation(outcome.conversationId);
        if (mounted.current) onConversationCreated?.(outcome.conversationId);
      } else if (userId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conciergeConversations(userId) });
      }
    } finally {
      setSavingIds((ids) => ids.filter((id) => id !== replyId));
    }
  }

  function landOutcome(outcome: ConciergeTurnOutcome, msgId: number, openAtSend: string | null) {
    const markSent = (changes: Partial<Msg>) =>
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, ...changes } : m)));
    switch (outcome.status) {
      case "busy":
        return;
      case "answered": {
        // Answered live: her job is done here, so it is never offered back.
        if (outcome.jobId) dismissRef.current(outcome.jobId);
        keptFiles.current.delete(msgId);
        const unsaved = !outcome.saved;
        const replyId = nextMsgId++;
        if (outcome.save) unsavedTurns.current.set(replyId, outcome.save);
        setMessages((prev) => [
          ...prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  failed: false,
                  failedNote: undefined,
                  note: undefined,
                  unsaved,
                  clientRequestId: outcome.clientRequestId,
                }
              : m,
          ),
          {
            id: replyId,
            role: "assistant",
            content: outcome.reply,
            ts: Date.now(),
            clientRequestId: outcome.clientRequestId,
            unsaved,
          },
        ]);
        if (outcome.conversationId && outcome.conversationId !== conversationIdRef.current) {
          setConversation(outcome.conversationId);
          if (openAtSend === null && mounted.current) {
            onConversationCreated?.(outcome.conversationId);
          }
        }
        return;
      }
      case "lost":
        // Her id is kept: Try again resends it, and the server replays instead of charging.
        markSent({ failed: true, failedNote: undefined });
        // With jobs live her row speaks (still composing, the reply, or a calm failure).
        if (!jobsLiveRef.current) toast.error(CONCIERGE_COPY.slow);
        return;
      case "refused":
        markSent({ failed: true, failedNote: undefined });
        if (isInsufficientCreditsError(outcome.error)) setCreditPaywallOpen(true);
        else if (outcome.stage === "upload") toast.error(CONCIERGE_COPY.uploadFailed);
        else toast.error(errorMessage(outcome.error, "Mila couldn't respond just now."));
        return;
      case "delivered":
        keptFiles.current.delete(msgId);
        if (userId) {
          void applyConciergeRecovery(
            {
              kind: "delivered",
              job: outcome.job,
              own: true,
              target: outcome.job.link.conversationId,
            },
            recoveryDeps(userId),
          );
        }
        return;
    }
  }

  async function send(text: string, retryId?: number) {
    const trimmed = text.trim();
    if (!trimmed || preparing || sending || composing || sender.busy) return;
    if (!user) {
      toast.error("Please sign in again to chat with Mila.");
      return;
    }

    let userMsg: Msg;
    let priorMessages: Msg[];
    let file: File | null;
    if (retryId != null) {
      const found = messages.find((m) => m.id === retryId);
      if (!found) return;
      userMsg = found;
      priorMessages = messages.slice(0, messages.indexOf(found));
      // The retry keeps her photo: the uploaded URL, or the file she picked.
      file = keptFiles.current.get(retryId) ?? null;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === retryId ? { ...m, failed: false, failedNote: undefined, note: undefined } : m,
        ),
      );
    } else {
      file = attachment?.file ?? null;
      userMsg = {
        id: nextMsgId++,
        role: "user",
        content: trimmed,
        ts: Date.now(),
        imageUrl: attachment?.preview,
      };
      if (file) keptFiles.current.set(userMsg.id, file);
      priorMessages = messages;
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      // The preview now belongs to her message (revoked when the chat unmounts).
      setAttachment(null);
    }
    const msgId = userMsg.id;
    const patch = (changes: Partial<Msg>) =>
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, ...changes } : m)));
    const openAtSend = conversationIdRef.current;
    setSending(true);

    try {
      const outcome = await sender.send(
        {
          userId: user.id,
          message: trimmed,
          history: priorMessages
            .filter((m) => !m.failed)
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content })),
          lookId: look?.lookId ?? null,
          conversationId: openAtSend,
          file,
          uploadedUrl: userMsg.uploadedUrl ?? null,
          previousRequestId: userMsg.clientRequestId ?? null,
        },
        {
          onUploaded: (url) => patch({ uploadedUrl: url }),
          onRequestId: (id) => {
            patch({ clientRequestId: id });
            setCalling(true);
          },
        },
      );
      landOutcome(outcome, msgId, openAtSend);
    } finally {
      setSending(false);
      setCalling(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(user?.id) });
    }
  }

  return (
    <>
      <UpgradeSlotsDialog open={creditPaywallOpen} onOpenChange={setCreditPaywallOpen} />

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 sm:px-7 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          {loadFailed && (
            <div
              role="alert"
              className="flex items-center justify-center gap-2 text-label text-destructive"
            >
              Couldn't open this conversation.
              <button
                type="button"
                onClick={() => setLoadAttempt((n) => n + 1)}
                className="inline-flex min-h-11 items-center gap-1 px-1 underline underline-offset-2 hover:text-foreground transition-colors"
              >
                <RotateCcw className="size-3" aria-hidden="true" /> Try again
              </button>
            </div>
          )}
          {messages.length === 0 && !pendingBubble && !loadFailed && (
            <div className="pt-8 text-center px-4">
              <Sparkles className="size-6 mx-auto text-accent mb-4" strokeWidth={1.5} />
              <p className="font-serif text-xl leading-snug">
                {look ? `We're studying “${look.title}.”` : "How can I help you style today?"}
              </p>
              <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">
                {look
                  ? "Ask anything about this look: pairings, refinements, occasions, or palette fit."
                  : "Ask about outfits, color, proportions, beauty, occasions, packing, or wardrobe planning."}
              </p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              // While Mila composes this very turn from its row, it is not "Not sent".
              msg={m.clientRequestId === recoveringRequestId ? { ...m, failed: false } : m}
              onRetry={() => send(m.content, m.id)}
              onSave={unsavedTurns.current.has(m.id) ? () => persistExchange(m.id) : undefined}
              saving={savingIds.includes(m.id)}
              sending={sending || composing}
            />
          ))}
          {pendingBubble && (
            <MessageBubble key="recovered-pending" msg={pendingBubble} onRetry={() => {}} sending />
          )}
          {(sending || composing) && (
            <div
              className="flex gap-3 items-start"
              role="status"
              aria-label={
                canLeave
                  ? `Mila is composing a reply. ${CONCIERGE_COPY.leave}`
                  : "Mila is composing a reply"
              }
            >
              <div className="shrink-0 size-8 rounded-full bg-foreground text-background flex items-center justify-center">
                <Sparkles className="size-4 text-accent" strokeWidth={1.75} aria-hidden="true" />
              </div>
              <div className="rounded-2xl bg-secondary/70 text-muted-foreground px-4 py-2.5 text-sm flex flex-col gap-1 shadow-sm">
                <span className="flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Mila is
                  composing…
                </span>
                {canLeave && <span className="text-label">{CONCIERGE_COPY.leave}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-foreground/5 dark:border-white/10 px-4 sm:px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-background/60 backdrop-blur-xl"
      >
        <div className="mx-auto w-full max-w-3xl space-y-2.5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick styling prompts">
            {quickPrompts.map((p) => (
              <button
                key={p}
                type="button"
                disabled={composer.promptsDisabled}
                onClick={() => send(p)}
                className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 bg-background/70 px-3 py-1.5 text-label text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
              >
                <Wand2 className="size-3 text-accent" strokeWidth={1.75} aria-hidden="true" />
                {p}
              </button>
            ))}
          </div>

          {!look && archive.length > 0 && (
            <div>
              <button
                type="button"
                onClick={toggleArchive}
                aria-expanded={archiveOpen}
                className="flex w-full items-center justify-between text-micro uppercase tracking-label-xwide text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                Ask about a look from your archive
                {archiveOpen ? (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronUp className="size-3.5" aria-hidden="true" />
                )}
              </button>
              {archiveOpen && (
                <div className="mt-2 flex gap-2.5 overflow-x-auto pb-1">
                  {archive.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() =>
                        onSelectLook({
                          lookId: o.id,
                          imageUrl: o.image_url,
                          title: o.title,
                          source: "From your archive",
                        })
                      }
                      className="group w-16 shrink-0 text-left"
                    >
                      <div className="size-16 overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10 transition group-hover:ring-foreground/30">
                        <LookThumbnail imageUrl={o.image_url} title={o.title} />
                      </div>
                      <p className="mt-1 text-micro leading-tight text-muted-foreground line-clamp-1">
                        {o.title}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {attachment && (
            <div className="flex w-fit items-center gap-2.5 rounded-xl border border-foreground/10 bg-background/50 p-2">
              <img
                src={attachment.preview}
                alt={attachment.file.name}
                className="size-10 rounded-lg object-cover"
              />
              <p className="max-w-40 truncate text-label text-muted-foreground">
                {attachment.file.name}
              </p>
              <button
                type="button"
                onClick={discardAttachment}
                aria-label="Remove attached image"
                className="rounded-full p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          {composer.status && (
            <p
              role="status"
              className="flex items-center gap-2 px-1 text-label text-muted-foreground"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> {composer.status}
            </p>
          )}

          {listening && (
            <p
              role="status"
              className="flex items-center gap-2 px-1 text-micro uppercase tracking-label-xwide text-accent"
            >
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
              </span>
              Listening. Tap the mic to stop
            </p>
          )}

          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                listening ? "Listening…" : "Ask Mila about color, fit, or your next OOTD…"
              }
              aria-label="Message Mila"
              maxLength={2000}
              disabled={composer.inputDisabled}
              className={cn(
                "rounded-full border-foreground/15 bg-background/70 focus-visible:ring-0 px-4 h-10",
                listening && "border-accent/50",
              )}
            />
            <input
              ref={attachRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setPreparing(true);
                try {
                  const prepared = await prepareImageForUpload(f);
                  if (!mounted.current) return;
                  const preview = URL.createObjectURL(prepared);
                  previewUrls.current.add(preview);
                  const replaced = attachmentRef.current;
                  if (replaced) {
                    URL.revokeObjectURL(replaced.preview);
                    previewUrls.current.delete(replaced.preview);
                  }
                  setAttachment({ file: prepared, preview });
                } catch (err) {
                  toast.error(errorMessage(err, "Couldn't attach that photo. Please try again."));
                } finally {
                  if (mounted.current) setPreparing(false);
                }
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => attachRef.current?.click()}
              disabled={composer.attachDisabled}
              aria-label="Attach an image"
              className="rounded-full size-10 shrink-0 shadow-sm"
            >
              <ImagePlus className="size-4" aria-hidden="true" />
            </Button>
            {SpeechRecognitionCtor && (
              <Button
                type="button"
                size="icon"
                variant={listening ? "primary" : "outline"}
                onClick={toggleDictation}
                disabled={sending}
                aria-pressed={listening}
                aria-label={listening ? "Stop dictation" : "Dictate your message"}
                className={cn(
                  "rounded-full size-10 shrink-0 shadow-sm",
                  listening && "animate-pulse",
                )}
              >
                <Mic className="size-4" aria-hidden="true" />
              </Button>
            )}
            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              disabled={composer.sendDisabled}
              className="rounded-full size-10 shrink-0 shadow-sm"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
          <p className="px-1 text-micro text-muted-foreground">{CONCIERGE_COPY.cost}</p>
        </div>
      </form>
    </>
  );
}
