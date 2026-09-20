import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Images } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PostCanvas } from "@/components/feed/post-canvas";
import { OotdTaggingSheet } from "@/components/feed/ootd-tagging-sheet";
import { DualCapture } from "@/components/capture/dual-capture";
import type { PostItem } from "@/lib/outfit-items";
import { getFeed } from "@/lib/posts.functions";
import { publishOotd } from "@/lib/publish-ootd";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { queryKeys } from "@/constants/query-keys";
import { errorMessage } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorPanel } from "@/components/ui/error-state";

export const Route = createFileRoute("/_authenticated/_app/feed")({
  component: FeedPage,
});

function FeedPage() {
  const { user } = useAuth();
  const fetchFeed = useServerFn(getFeed);
  const queryClient = useQueryClient();
  const [isPostOpen, setIsPostOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tagging, setTagging] = useState<{ postId: string; items: PostItem[] } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.feed(user?.id),
    queryFn: () => fetchFeed(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const posts = data?.posts ?? [];

  async function handleSubmit(back: File, front: File, caption: string) {
    if (!user) return;
    setSubmitting(true);
    try {
      const { postId, items } = await publishOotd({ userId: user.id, back, front, caption });
      toast.success("Today's OOTD posted.");
      setIsPostOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.feed(user.id) });
      if (items.length) setTagging({ postId, items });
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't post today's OOTD."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="atelier-page-narrow space-y-8 relative">
        <header className="text-center space-y-3">
          <p className="text-micro uppercase tracking-label-max text-muted-foreground">
            The Atelier Feed
          </p>
          <h1 className="font-serif text-4xl md:text-5xl text-ink leading-tight">
            Today's looks, in real time
          </h1>
          <p className="text-sm text-stone max-w-md mx-auto">
            One outfit, one mirror, one mood — your community's daily blueprints.
          </p>
          <Button
            type="button"
            variant="primary"
            size="pill"
            onClick={() => setIsPostOpen(true)}
            className="px-8"
          >
            <Camera className="size-4" strokeWidth={1.75} />
            Post Today's OOTD
          </Button>
        </header>

        {isLoading && (
          <div className="space-y-6">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="rounded-card border border-border bg-card shadow-paper overflow-hidden"
              >
                <Skeleton className="h-16" />
                <Skeleton className="aspect-3/4" />
              </div>
            ))}
          </div>
        )}

        {isError && <LoadErrorPanel title="Feed couldn't load." onRetry={() => refetch()} />}

        {!isLoading && !isError && posts.length === 0 && (
          <EmptyState
            role="status"
            className="mx-auto max-w-xl"
            icon={<Images className="size-8" strokeWidth={1.25} />}
            title="You're first to the mirror today."
            description="As your circle posts, their looks will land here."
          />
        )}

        {!isLoading && posts.length > 0 && (
          <div className="space-y-6">
            {posts.map((p) => (
              <PostCanvas key={p.id} post={p} />
            ))}
          </div>
        )}
      </section>

      <Sheet open={isPostOpen} onOpenChange={(o) => !submitting && setIsPostOpen(o)}>
        <SheetContent side="bottom" className="px-6 pt-8 pb-10 max-h-[95vh] overflow-y-auto">
          <SheetHeader className="text-center space-y-2 mb-6">
            <p className="text-micro uppercase tracking-label-max text-muted-foreground">
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

      {tagging && user && (
        <OotdTaggingSheet
          key={tagging.postId}
          postId={tagging.postId}
          items={tagging.items}
          userId={user.id}
          open
          onOpenChange={(open) => !open && setTagging(null)}
        />
      )}
    </>
  );
}
