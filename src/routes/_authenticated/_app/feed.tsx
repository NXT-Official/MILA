import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Lock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PostCanvas } from "@/components/feed/post-canvas";
import { DualCapture } from "@/components/capture/dual-capture";
import { getFeed, createPost } from "@/lib/posts.functions";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { queryKeys } from "@/constants/query-keys";

export const Route = createFileRoute("/_authenticated/_app/feed")({
  component: FeedPage,
});

function FeedPage() {
  const { user } = useAuth();
  const fetchFeed = useServerFn(getFeed);
  const submitPost = useServerFn(createPost);
  const queryClient = useQueryClient();
  const [isPostOpen, setIsPostOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.feed(user?.id),
    queryFn: () => fetchFeed(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const locked = !isLoading && data && !data.has_posted_today;
  const posts = data?.posts ?? [];

  async function handleSubmit(back: File, front: File, caption: string) {
    if (!user) return;
    setSubmitting(true);
    try {
      const stamp = Date.now();
      const backPath = `${user.id}/back-${stamp}.jpg`;
      const frontPath = `${user.id}/front-${stamp}.jpg`;
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.storage
          .from("posts")
          .upload(backPath, back, { contentType: "image/jpeg", upsert: false }),
        supabase.storage
          .from("posts")
          .upload(frontPath, front, { contentType: "image/jpeg", upsert: false }),
      ]);
      if (e1 || e2) throw new Error(e1?.message || e2?.message || "Upload failed");
      await submitPost({
        data: {
          image_path_back: backPath,
          image_path_front: frontPath,
          caption: caption || null,
        },
      });
      toast.success("Today's OOTD posted — feed unlocked.");
      setIsPostOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.feed(user.id) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't post today's OOTD.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="max-w-2xl mx-auto px-4 md:px-6 py-10 md:py-14 space-y-8 relative">
        <header className="text-center space-y-3">
          <p className="text-[10px] uppercase tracking-[0.42em] text-muted-foreground">
            The Atelier Feed
          </p>
          <h1 className="font-serif text-4xl md:text-5xl text-ink leading-tight">
            Today's looks, in real time
          </h1>
          <p className="text-sm text-stone max-w-md mx-auto">
            One outfit, one mirror, one mood — your community's daily blueprints.
          </p>
        </header>

        {isLoading && (
          <div className="space-y-6">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="rounded-3xl border border-porcelain/60 bg-background/60 backdrop-blur overflow-hidden"
              >
                <div className="h-16 bg-porcelain/30" />
                <div className="aspect-3/4 bg-porcelain/20 animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="rounded-3xl border border-destructive/30 p-8 text-center">
            <p className="font-serif text-lg text-ink">Feed couldn't load.</p>
            <button
              onClick={() => refetch()}
              className="mt-3 text-[10px] uppercase tracking-[0.28em] text-stone hover:text-ink"
            >
              Try again
            </button>
          </div>
        )}

        {!isLoading && data?.has_posted_today && posts.length === 0 && (
          <div className="rounded-3xl border border-dashed border-porcelain/70 p-10 text-center">
            <p className="font-serif text-xl text-ink">You're first to the mirror today.</p>
            <p className="mt-2 text-sm text-stone">
              As your circle posts, their looks will land here.
            </p>
          </div>
        )}

        {!isLoading && data?.has_posted_today && posts.length > 0 && (
          <div className="space-y-6">
            {posts.map((p) => (
              <PostCanvas key={p.id} post={p} />
            ))}
          </div>
        )}

        {locked && (
          <>
            <div className="space-y-6 pointer-events-none select-none blur-sm opacity-60">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="rounded-3xl border border-porcelain/60 bg-background/70 overflow-hidden"
                >
                  <div className="h-16 bg-porcelain/40" />
                  <div className="aspect-3/4 bg-linear-to-br from-porcelain/40 via-atelier-ivory/60 to-porcelain/30" />
                </div>
              ))}
            </div>

            <div className="fixed inset-x-0 bottom-0 top-16 z-30 flex items-center justify-center px-6">
              <div className="pointer-events-none absolute inset-0 backdrop-blur-xl bg-background/40" />
              <div className="relative max-w-md w-full rounded-overlay border border-porcelain/70 bg-background/80 backdrop-blur-2xl shadow-atelier-float p-8 md:p-10 text-center space-y-6">
                <div className="mx-auto size-14 rounded-full border border-porcelain/70 bg-atelier-ivory/70 flex items-center justify-center">
                  <Lock className="size-5 text-ink" strokeWidth={1.25} />
                </div>
                <div className="space-y-3">
                  <p className="text-[10px] uppercase tracking-[0.42em] text-muted-foreground">
                    Anti-Lurker Gate
                  </p>
                  <h2 className="font-serif text-3xl md:text-4xl text-ink leading-tight">
                    Your friends' looks are locked.
                  </h2>
                  <p className="text-sm text-stone max-w-sm mx-auto leading-relaxed">
                    Reveal your Atelier Blueprint to unlock today's stream. One mirror selfie, one
                    face, one moment — and the feed is yours.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPostOpen(true)}
                  className="inline-flex items-center justify-center gap-2 h-12 px-8 rounded-full bg-ink text-atelier-ivory text-[10px] uppercase tracking-[0.32em] hover:bg-ink/90 transition-colors shadow-atelier-soft"
                >
                  <Camera className="size-4" strokeWidth={1.75} />
                  Post Today's OOTD
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <Sheet open={isPostOpen} onOpenChange={(o) => !submitting && setIsPostOpen(o)}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl border-t border-porcelain/60 px-6 pt-8 pb-10 max-h-[95vh] overflow-y-auto"
        >
          <SheetHeader className="text-center space-y-2 mb-6">
            <p className="text-[10px] uppercase tracking-[0.42em] text-muted-foreground">
              Daily Drop
            </p>
            <SheetTitle className="font-serif text-3xl leading-tight">Post Today's OOTD</SheetTitle>
            <SheetDescription className="max-w-md mx-auto text-sm">
              Two captures, head to toe — your fit, then your face & hair.
            </SheetDescription>
          </SheetHeader>
          <div className="max-w-md mx-auto">
            <DualCapture
              onSubmit={handleSubmit}
              onCancel={() => setIsPostOpen(false)}
              submitting={submitting}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
