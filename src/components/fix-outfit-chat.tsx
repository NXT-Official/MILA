import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, Sparkles, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fixOutfitChat } from "@/lib/fix-outfit-chat.functions";
import { toast } from "sonner";
import { isInsufficientCreditsError } from "@/lib/credits";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  imageUrl: string;
  bodyType: string;
  colorSeason: string;
  initialCritique: string;
  onInsufficientCredits?: () => void;
}

const QUICK_PILLS = [
  "How can I style this with a belt?",
  "What shoe color would fix this?",
  "Make this more casual",
];

export function FixOutfitChat({ imageUrl, bodyType, colorSeason, initialCritique, onInsufficientCredits }: Props) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content: `Hi — I'm your AI Stylist. Here's the gist of my read on this look: ${initialCritique} Ask me to swap a piece, fix a color, or tone the vibe up or down.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [tip, setTip] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chat = useServerFn(fixOutfitChat);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const res = await chat({
        data: {
          imageUrl,
          bodyType,
          colorSeason,
          history: messages,
          message: trimmed,
        },
      });
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
      if (res.tip && res.tip.trim()) setTip(res.tip.trim());
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
        onInsufficientCredits?.();
      } else {
        toast.error(e instanceof Error ? e.message : "Stylist chat failed.");
      }
      setMessages((prev) => prev.slice(0, -1));
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-12">
      <div className="flex items-center gap-4 mb-6">
        <div className="h-px flex-1 bg-border" />
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          Tweak your look with AI
        </p>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="bg-card border border-border rounded-sm overflow-hidden">
        {tip && (
          <div className="flex items-start gap-3 border-b border-border bg-accent/10 px-5 py-3">
            <Lightbulb className="h-4 w-4 mt-0.5 text-accent shrink-0" strokeWidth={1.5} />
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Stylist Tip
              </p>
              <p className="text-sm font-medium leading-snug mt-0.5">{tip}</p>
            </div>
          </div>
        )}

        <div
          ref={scrollRef}
          className="h-80 overflow-y-auto px-5 py-5 space-y-4 bg-background/40"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {m.role === "assistant" && (
                <div className="shrink-0 h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-[var(--atelier-gold)]" strokeWidth={1.5} />
                </div>
              )}
              <div
                className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-foreground text-background rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                }`}
              >
                {m.role === "assistant" && (
                  <p className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-1">
                    AI Stylist
                  </p>
                )}
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex gap-3 justify-start">
              <div className="shrink-0 h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-[var(--atelier-gold)]" strokeWidth={1.5} />
              </div>
              <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 text-sm flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-border bg-card px-4 py-3 flex items-center gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask for an alternative, swap an item, or get a quick fix..."
            disabled={sending}
            className="border-0 shadow-none focus-visible:ring-0 bg-transparent"
          />
          <Button type="submit" size="icon" disabled={sending || !input.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_PILLS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={sending}
            onClick={() => send(p)}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}