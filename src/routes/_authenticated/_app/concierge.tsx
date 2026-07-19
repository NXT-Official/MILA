import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SquarePen, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConciergeChat, AnchoredLookCard } from "@/components/concierge/concierge-chat";
import { useAuth } from "@/hooks/use-auth";
import { useConcierge } from "@/hooks/use-concierge";
import { profileQueryOptions } from "@/lib/queries/profile";

export const Route = createFileRoute("/_authenticated/_app/concierge")({
  component: ConciergePage,
});

function ConciergePage() {
  const { user } = useAuth();
  const { look, clearLook, openConcierge } = useConcierge();
  const { data: profile } = useQuery({
    ...profileQueryOptions(user?.id),
    enabled: !!user?.id,
  });
  const [chatKey, setChatKey] = useState(0);

  const seasonBadges = [profile?.body_type, profile?.color_season].filter(Boolean) as string[];

  function newChat() {
    clearLook();
    setChatKey((k) => k + 1);
  }

  return (
    <div className="flex h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-4rem)]">
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-foreground/5 dark:border-white/10 bg-card/40">
        <div className="p-4">
          <button
            type="button"
            onClick={newChat}
            className="flex w-full items-center gap-2.5 rounded-xl border border-foreground/10 bg-background/60 px-4 py-3 text-sm text-foreground hover:border-foreground/25 transition-colors"
          >
            <SquarePen className="size-4 text-accent" strokeWidth={1.75} aria-hidden="true" />
            New chat
          </button>
        </div>
        <p className="px-6 pt-2 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
          Recents
        </p>
        <div className="flex-1 px-6 py-4">
          {/* ponytail: placeholder — persisted chat history lands here next */}
          <div className="flex items-start gap-2.5 text-muted-foreground">
            <MessageSquare
              className="size-4 mt-0.5 shrink-0"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <p className="text-xs leading-relaxed">
              Your past conversations will appear here soon.
            </p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-foreground/5 dark:border-white/10 px-5 sm:px-8 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.42em] text-muted-foreground/80 font-medium">
                Mila's Insights
              </p>
              <h1 className="font-serif text-2xl leading-tight tracking-[-0.01em]">
                Mila's Styling Studio
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {seasonBadges.map((b) => (
                <Badge
                  key={b}
                  variant="outline"
                  className="rounded-full px-3 py-0.5 text-[10px] font-normal uppercase tracking-[0.22em] border-foreground/15 bg-background/40"
                >
                  {b}
                </Badge>
              ))}
              <button
                type="button"
                onClick={newChat}
                className="md:hidden inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
              >
                <SquarePen className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                New chat
              </button>
            </div>
          </div>
          {look && <AnchoredLookCard look={look} onClear={clearLook} className="mt-3 max-w-md" />}
        </header>

        <ConciergeChat key={chatKey} look={look} onSelectLook={(l) => openConcierge(l)} />
      </div>
    </div>
  );
}
