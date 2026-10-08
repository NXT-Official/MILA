import { Loader2, RotateCcw, Save, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { CONCIERGE_COPY } from "@/hooks/use-concierge-send";
import type { Msg } from "@/components/concierge/types";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({
  msg,
  onRetry,
  onSave,
  saving = false,
  sending,
}: {
  msg: Msg;
  onRetry: () => void;
  /** Retries saving an unsaved reply (the write only: no chat call, no credit). */
  onSave?: () => void;
  saving?: boolean;
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
        <p className="text-nano uppercase tracking-label-xwide text-muted-foreground">
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
          <div role="alert" className="flex items-center gap-2 text-label text-destructive">
            {msg.failedNote ?? "Not sent."}
            <button
              type="button"
              onClick={onRetry}
              disabled={sending}
              className="inline-flex min-h-11 items-center gap-1 px-1 underline underline-offset-2 hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RotateCcw className="size-3" aria-hidden="true" /> Try again
            </button>
          </div>
        )}
        {!msg.failed && msg.note && (
          <p role="status" className="text-label text-muted-foreground">
            {msg.note}
          </p>
        )}
        {!isUser && msg.unsaved && (
          <div role="status" className="flex items-center gap-2 text-label text-muted-foreground">
            {CONCIERGE_COPY.unsaved}
            {onSave && (
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="inline-flex min-h-11 items-center gap-1 px-1 text-foreground underline underline-offset-2 hover:text-accent transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-3" aria-hidden="true" />
                )}
                {saving ? CONCIERGE_COPY.saving : CONCIERGE_COPY.save}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
