import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, Sparkles, Shirt, RotateCcw, X, Wand2 } from "lucide-react";
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
import type { ConciergeLook } from "@/hooks/use-concierge";
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
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Anchored saved look, or null for a general styling conversation. */
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

let nextMsgId = 1;

export function StylistConciergeDrawer({ open, onOpenChange, look, onClearLook, profile }: Props) {
  // Conversation state lives here (in the always-mounted app shell), so it
  // survives closing and reopening the drawer within a session. Persistence
  // across sessions is deliberately not implemented yet — see
  // IN_DEVELOPMENT.txt if that changes.
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLookIdRef = useRef<string | null>(look?.lookId ?? null);
  const chat = useServerFn(conciergeChat);

  // Anchoring a different look starts a fresh conversation so earlier
  // image-specific replies can't bleed into the new look's context.
  // Removing the anchor keeps the conversation and continues generally.
  useEffect(() => {
    const id = look?.lookId ?? null;
    if (id && id !== prevLookIdRef.current) setMessages([]);
    if (id) prevLookIdRef.current = id;
  }, [look?.lookId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const quickPrompts = look ? ANCHORED_PROMPTS : GENERAL_PROMPTS;

  const seasonBadges = useMemo(
    () => [profile.bodyType, profile.colorSeason].filter(Boolean) as string[],
    [profile.bodyType, profile.colorSeason],
  );

  /** Sends `text`; when `retryId` is set, re-sends that failed message instead of appending. */
  async function send(text: string, retryId?: number) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    let userMsg: Msg;
    let priorMessages: Msg[];
    if (retryId != null) {
      userMsg = messages.find((m) => m.id === retryId)!;
      priorMessages = messages.slice(0, messages.indexOf(userMsg));
      setMessages((prev) => prev.map((m) => (m.id === retryId ? { ...m, failed: false } : m)));
    } else {
      userMsg = { id: nextMsgId++, role: "user", content: trimmed, ts: Date.now() };
      priorMessages = messages;
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
    }
    setSending(true);

    try {
      const res = await chat({
        data: {
          message: trimmed,
          history: priorMessages
            .filter((m) => !m.failed)
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content })),
          lookId: look?.lookId ?? null,
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

          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Mila about color, fit, or your next OOTD…"
              aria-label="Message Mila"
              maxLength={2000}
              disabled={sending}
              className="rounded-full border-foreground/15 bg-background/70 focus-visible:ring-0 px-4 h-10"
            />
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
            "px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words rounded-2xl shadow-sm",
            isUser
              ? "bg-foreground text-background rounded-br-sm"
              : "bg-secondary/70 backdrop-blur-sm text-foreground border border-foreground/10 rounded-bl-sm",
          )}
        >
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
