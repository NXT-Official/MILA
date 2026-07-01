import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, Sparkles, Lightbulb, Shirt, Wand2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fixOutfitChat } from "@/lib/fix-outfit-chat.functions";
import { isInsufficientCreditsError } from "@/lib/credits";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface StylistItemContext {
  imageUrl: string;
  name?: string | null;
  category?: string | null;
  primaryColor?: string | null;
  colorUndertone?: string | null;
  silhouetteTags?: string[] | null;
}

export interface StylistProfileContext {
  bodyType: string | null | undefined;
  colorSeason: string | null | undefined;
  skinUndertone?: string | null;
}

type Msg = { role: "user" | "assistant"; content: string; ts: number };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item?: StylistItemContext | null;
  profile: StylistProfileContext;
  onInsufficientCredits?: () => void;
}

function pillsFor(profile: StylistProfileContext, hasItem: boolean): string[] {
  const body = profile.bodyType ?? "my frame";
  const season = profile.colorSeason ?? "my season";
  if (hasItem) {
    return [
      `How do I style this to balance my ${body} proportions?`,
      `What accent colors pair with this for an evening out?`,
      `Refine this piece into something more elevated.`,
    ];
  }
  return [
    `Compose an evening look that flatters a ${body} silhouette.`,
    `Which neutrals anchor a ${season} palette?`,
    `Which silhouettes should I avoid for my ${body} architecture?`,
  ];
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function StylistConciergeDrawer({
  open,
  onOpenChange,
  item,
  profile,
  onInsufficientCredits,
}: Props) {
  const profileReady = !!(profile.bodyType && profile.colorSeason);
  const itemReady = !!item?.imageUrl;

  const greeting = useMemo<Msg>(() => {
    const who =
      profile.bodyType && profile.colorSeason
        ? `Your file is open: ${profile.bodyType} silhouette, ${profile.colorSeason} palette.`
        : "Finish your style profile so I can tune every reply.";
    const focus = item?.name ? ` We're studying your ${item.name.toLowerCase()}.` : "";
    return {
      role: "assistant",
      content: `Welcome to Mila's Styling Studio. ${who}${focus} Ask anything — proportions, palette, pairings, or your next OOTD.`,
      ts: Date.now(),
    };
  }, [profile.bodyType, profile.colorSeason, item?.name]);

  const [messages, setMessages] = useState<Msg[]>([greeting]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [tip, setTip] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chat = useServerFn(fixOutfitChat);

  useEffect(() => {
    if (open) {
      setMessages([greeting]);
      setTip(null);
      setInput("");
    }
  }, [open, greeting]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const quickPills = useMemo(() => pillsFor(profile, itemReady), [profile, itemReady]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (!profileReady) {
      toast.error("Mila needs your body type and color season first — complete your profile.");
      return;
    }

    const userMsg: Msg = { role: "user", content: trimmed, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    const anchorImage = item?.imageUrl ?? null;
    if (!anchorImage) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Snap or upload an outfit through the Studio Lens so I can anchor my read to a real photo.",
          ts: Date.now(),
        },
      ]);
      setSending(false);
      return;
    }
    try {
      const res = await chat({
        data: {
          imageUrl: anchorImage,
          bodyType: profile.bodyType!,
          colorSeason: profile.colorSeason!,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          message: trimmed,
        },
      });
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply, ts: Date.now() }]);
      if (res.tip && res.tip.trim()) setTip(res.tip.trim());
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
        onInsufficientCredits?.();
      } else {
        toast.error(e instanceof Error ? e.message : "Mila's studio is briefly unavailable.");
      }
      setMessages((prev) => prev.slice(0, -1));
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
        <SheetHeader className="px-8 pt-8 pb-6 border-b border-foreground/5 dark:border-white/10 text-left">
          <p className="text-[10px] uppercase tracking-[0.42em] text-muted-foreground/80 font-medium">
            Mila's Insights
          </p>
          <SheetTitle className="font-serif text-[28px] leading-tight tracking-[-0.01em] mt-1">
            Mila's Styling Studio
          </SheetTitle>
          <SheetDescription className="text-xs leading-relaxed mt-1.5 text-muted-foreground">
            Elite, studio-tuned guidance on silhouette, palette, and OOTD curation.
          </SheetDescription>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {profile.bodyType && (
              <Badge
                variant="outline"
                className="rounded-full px-3 py-0.5 text-[10px] font-normal uppercase tracking-[0.22em] border-foreground/15 bg-background/40"
              >
                {profile.bodyType}
              </Badge>
            )}
            {profile.colorSeason && (
              <Badge
                variant="outline"
                className="rounded-full px-3 py-0.5 text-[10px] font-normal uppercase tracking-[0.22em] border-foreground/15 bg-background/40"
              >
                {profile.colorSeason}
              </Badge>
            )}
            {item?.category && (
              <Badge
                variant="secondary"
                className="rounded-full px-3 py-0.5 text-[10px] font-normal uppercase tracking-[0.22em]"
              >
                {item.category}
              </Badge>
            )}
          </div>

          {item && (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-foreground/10 bg-background/50 p-2.5 shadow-sm">
              <div className="h-14 w-14 rounded-lg bg-muted overflow-hidden shrink-0 ring-1 ring-foreground/5">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name ?? "Item"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                    <Shirt className="h-5 w-5" strokeWidth={1.25} />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight truncate">
                  {item.name ?? "Selected piece"}
                </p>
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground mt-0.5 truncate">
                  {[item.primaryColor, item.colorUndertone].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
          )}
        </SheetHeader>

        {tip && (
          <div className="flex items-start gap-3 border-b border-foreground/5 dark:border-white/10 bg-secondary/60 backdrop-blur-sm px-8 py-4">
            <Lightbulb className="h-4 w-4 mt-0.5 text-foreground shrink-0" strokeWidth={1.5} />
            <div>
              <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                Stylist's Note
              </p>
              <p className="text-sm font-medium leading-snug mt-0.5">{tip}</p>
            </div>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-7 py-6 space-y-6">
          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
          {sending && (
            <div className="flex gap-3 items-start">
              <div className="shrink-0 h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-[var(--atelier-gold)]" strokeWidth={1.5} />
              </div>
              <div className="rounded-2xl bg-secondary/70 text-foreground px-4 py-2.5 text-sm flex items-center gap-2 text-muted-foreground shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Mila is composing…
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-foreground/5 dark:border-white/10 px-5 py-4 space-y-2.5 bg-background/60 backdrop-blur-xl"
        >
          <Select value="" onValueChange={(v) => v && send(v)} disabled={sending || !profileReady}>
            <SelectTrigger className="h-9 rounded-full border-foreground/15 bg-background/70 px-4 text-[11px] uppercase tracking-[0.22em] text-muted-foreground focus:ring-0">
              <span className="inline-flex items-center gap-2">
                <Wand2 className="h-3.5 w-3.5 text-[var(--atelier-gold)]" strokeWidth={1.5} />
                <SelectValue placeholder="Quick prompts" />
              </span>
            </SelectTrigger>
            <SelectContent className="bg-background/95 backdrop-blur-xl border-foreground/10">
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                  Styling
                </SelectLabel>
                {quickPills.map((p) => (
                  <SelectItem key={p} value={p} className="text-xs leading-snug whitespace-normal">
                    {p}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Mila about color, fit, or your next OOTD…"
              disabled={sending || !profileReady}
              className="rounded-full border-foreground/15 bg-background/70 focus-visible:ring-0 px-4 h-10"
            />
            <Button
              type="submit"
              size="icon"
              disabled={sending || !input.trim() || !profileReady}
              className="rounded-full h-10 w-10 shrink-0 shadow-sm"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="shrink-0 h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-[var(--atelier-gold)]" strokeWidth={1.5} />
        </div>
      )}
      <div className={cn("max-w-[80%] flex flex-col gap-1", isUser && "items-end")}>
        <p className="text-[9px] uppercase tracking-[0.32em] text-muted-foreground">
          {isUser ? "You" : "Mila"} · {formatTime(msg.ts)}
        </p>
        <div
          className={cn(
            "px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap rounded-2xl shadow-sm",
            isUser
              ? "bg-foreground text-background rounded-br-sm"
              : "bg-secondary/70 backdrop-blur-sm text-foreground border border-foreground/10 rounded-bl-sm",
          )}
        >
          {msg.content}
        </div>
      </div>
    </div>
  );
}
