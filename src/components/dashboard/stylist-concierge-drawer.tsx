import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  Send,
  Sparkles,
  Shirt,
  RotateCcw,
  X,
  Wand2,
  ChevronDown,
  ChevronUp,
  Mic,
  ImagePlus,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { conciergeChat } from "@/lib/concierge-chat.functions";
import { useConcierge, type ConciergeLook } from "@/hooks/use-concierge";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface StylistProfileContext {
  bodyType: string | null | undefined;
  colorSeason: string | null | undefined;
}

type Msg = {
  id: number;
  role: "user" | "assistant";
  content: string;
  ts: number;
  failed?: boolean;
  imageUrl?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  look: ConciergeLook | null;
  onClearLook: () => void;
  profile: StylistProfileContext;
}

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

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

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

// ponytail: minimal title extraction; history.tsx has the full normalizer if shapes grow
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

export function StylistConciergeDrawer({ open, onOpenChange, look, onClearLook, profile }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLookIdRef = useRef<string | null>(look?.lookId ?? null);
  const chat = useServerFn(conciergeChat);
  const { user } = useAuth();
  const { openConcierge } = useConcierge();
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(
    () => typeof localStorage === "undefined" || localStorage.getItem(ARCHIVE_OPEN_KEY) !== "0",
  );

  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationBaseRef = useRef("");
  const [attachment, setAttachment] = useState<{ file: File; preview: string } | null>(null);
  const attachRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!open) recognitionRef.current?.stop();
  }, [open]);

  function toggleArchive() {
    setArchiveOpen((v) => {
      localStorage.setItem(ARCHIVE_OPEN_KEY, v ? "0" : "1");
      return !v;
    });
  }

  useEffect(() => {
    if (!open || look || !user) return;
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
  }, [open, look, user]);

  useEffect(() => {
    const id = look?.lookId ?? null;
    if (id && id !== prevLookIdRef.current) setMessages([]);
    if (id) prevLookIdRef.current = id;
  }, [look?.lookId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const quickPrompts = attachment ? ATTACHMENT_PROMPTS : look ? ANCHORED_PROMPTS : GENERAL_PROMPTS;

  const seasonBadges = useMemo(
    () => [profile.bodyType, profile.colorSeason].filter(Boolean) as string[],
    [profile.bodyType, profile.colorSeason],
  );

  async function send(text: string, retryId?: number) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    // ponytail: retrying a failed message re-sends its text only, not its attachment
    const attached = retryId == null ? attachment : null;

    let userMsg: Msg;
    let priorMessages: Msg[];
    if (retryId != null) {
      userMsg = messages.find((m) => m.id === retryId)!;
      priorMessages = messages.slice(0, messages.indexOf(userMsg));
      setMessages((prev) => prev.map((m) => (m.id === retryId ? { ...m, failed: false } : m)));
    } else {
      userMsg = {
        id: nextMsgId++,
        role: "user",
        content: trimmed,
        ts: Date.now(),
        imageUrl: attached?.preview,
      };
      priorMessages = messages;
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setAttachment(null);
    }
    setSending(true);

    try {
      let uploadedUrl: string | null = null;
      if (attached) {
        if (!user) throw new Error("Sign in to attach a photo.");
        const ext = (attached.file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("outfits")
          .upload(path, attached.file, { contentType: attached.file.type || "image/jpeg" });
        if (upErr) throw upErr;
        uploadedUrl = supabase.storage.from("outfits").getPublicUrl(path).data.publicUrl;
      }
      const res = await chat({
        data: {
          message: trimmed,
          history: priorMessages
            .filter((m) => !m.failed)
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content })),
          lookId: look?.lookId ?? null,
          imageUrl: uploadedUrl,
        },
      });
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId++, role: "assistant", content: res.reply, ts: Date.now() },
      ]);
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, failed: true } : m)));
      toast.error(e instanceof Error ? e.message : "Mila couldn't respond just now.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
        <SheetHeader className="px-6 sm:px-8 pt-8 pb-5 border-b border-foreground/5 dark:border-white/10 text-left">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.42em] text-muted-foreground/80 font-medium">
                Mila's Insights
              </p>
              <SheetTitle className="font-serif text-[28px] leading-tight tracking-[-0.01em] mt-1">
                Mila's Styling Studio
              </SheetTitle>
              <SheetDescription className="text-xs leading-relaxed mt-1.5 text-muted-foreground">
                Personal guidance on outfits, color, proportions, beauty, and occasions.
              </SheetDescription>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="shrink-0 mt-1 text-[10px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
              >
                New chat
              </button>
            )}
          </div>

          {seasonBadges.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {seasonBadges.map((b) => (
                <Badge
                  key={b}
                  variant="outline"
                  className="rounded-full px-3 py-0.5 text-[10px] font-normal uppercase tracking-[0.22em] border-foreground/15 bg-background/40"
                >
                  {b}
                </Badge>
              ))}
            </div>
          )}

          {look && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-foreground/10 bg-background/50 p-2.5 shadow-sm">
              <div className="size-14 rounded-lg bg-muted overflow-hidden shrink-0 ring-1 ring-foreground/5">
                <LookThumbnail imageUrl={look.imageUrl} title={look.title} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight truncate">{look.title}</p>
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground mt-0.5 truncate">
                  {look.source}
                </p>
              </div>
              <button
                type="button"
                onClick={onClearLook}
                aria-label="Remove this look from the conversation"
                className="shrink-0 p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          )}
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 sm:px-7 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="pt-8 text-center px-4">
              <Sparkles className="size-6 mx-auto text-accent mb-4" strokeWidth={1.5} />
              <p className="font-serif text-xl leading-snug">
                {look ? `We're studying “${look.title}.”` : "How can I help you style today?"}
              </p>
              <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">
                {look
                  ? "Ask anything about this look — pairings, refinements, occasions, or palette fit."
                  : "Ask about outfits, color, proportions, beauty, occasions, packing, or wardrobe planning."}
              </p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              onRetry={() => send(m.content, m.id)}
              sending={sending}
            />
          ))}
          {sending && (
            <div
              className="flex gap-3 items-start"
              role="status"
              aria-label="Mila is composing a reply"
            >
              <div className="shrink-0 size-8 rounded-full bg-foreground text-background flex items-center justify-center">
                <Sparkles className="size-4 text-accent" strokeWidth={1.75} aria-hidden="true" />
              </div>
              <div className="rounded-2xl bg-secondary/70 text-muted-foreground px-4 py-2.5 text-sm flex items-center gap-2 shadow-sm">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Mila is composing…
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-foreground/5 dark:border-white/10 px-4 sm:px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2.5 bg-background/60 backdrop-blur-xl"
        >
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick styling prompts">
            {quickPrompts.map((p) => (
              <button
                key={p}
                type="button"
                disabled={sending}
                onClick={() => send(p)}
                className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 bg-background/70 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
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
                className="flex w-full items-center justify-between text-[10px] uppercase tracking-[0.32em] text-muted-foreground hover:text-foreground transition-colors py-1"
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
                        openConcierge({
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
                      <p className="mt-1 text-[10px] leading-tight text-muted-foreground line-clamp-1">
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
                alt="Attached image preview"
                className="size-10 rounded-lg object-cover"
              />
              <p className="max-w-40 truncate text-[11px] text-muted-foreground">
                {attachment.file.name}
              </p>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label="Remove attached image"
                className="rounded-full p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          {listening && (
            <p
              role="status"
              className="flex items-center gap-2 px-1 text-[10px] uppercase tracking-[0.32em] text-accent"
            >
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
              </span>
              Listening — tap the mic to stop
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
              disabled={sending}
              className={cn(
                "rounded-full border-foreground/15 bg-background/70 focus-visible:ring-0 px-4 h-10",
                listening && "border-accent/50",
              )}
            />
            <input
              ref={attachRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (!f.type.startsWith("image/")) {
                  toast.error("Images only, please.");
                  return;
                }
                setAttachment({ file: f, preview: URL.createObjectURL(f) });
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => attachRef.current?.click()}
              disabled={sending}
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
              disabled={sending || !input.trim()}
              className="rounded-full size-10 shrink-0 shadow-sm"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function LookThumbnail({ imageUrl, title }: { imageUrl: string | null; title: string }) {
  const [broken, setBroken] = useState(false);
  if (!imageUrl || broken) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground">
        <Shirt className="size-5" strokeWidth={1.25} aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={imageUrl}
      alt={`Anchored look: ${title}`}
      className="h-full w-full object-cover"
      onError={() => setBroken(true)}
    />
  );
}

function MessageBubble({
  msg,
  onRetry,
  sending,
}: {
  msg: Msg;
  onRetry: () => void;
  sending: boolean;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="shrink-0 size-8 rounded-full bg-foreground text-background flex items-center justify-center">
          <Sparkles className="size-4 text-accent" strokeWidth={1.75} aria-hidden="true" />
        </div>
      )}
      <div className={cn("max-w-[80%] flex flex-col gap-1", isUser && "items-end")}>
        <p className="text-[9px] uppercase tracking-[0.32em] text-muted-foreground">
          {isUser ? "You" : "Mila"} · {formatTime(msg.ts)}
        </p>
        <div
          className={cn(
            "px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap wrap-break-words rounded-2xl shadow-sm",
            isUser
              ? "bg-foreground text-background rounded-br-sm"
              : "bg-secondary/70 backdrop-blur-sm text-foreground border border-foreground/10 rounded-bl-sm",
          )}
        >
          {msg.imageUrl && (
            <img
              src={msg.imageUrl}
              alt="Attached to this message"
              className="mb-2 max-h-40 rounded-xl object-cover"
            />
          )}
          {msg.content}
        </div>
        {msg.failed && (
          <div role="alert" className="flex items-center gap-2 text-[11px] text-destructive">
            Not sent.
            <button
              type="button"
              onClick={onRetry}
              disabled={sending}
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RotateCcw className="size-3" aria-hidden="true" /> Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
