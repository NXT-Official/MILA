import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Images, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { Stagger, StaggerItem } from "@/components/ui/stagger";

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
  const locked = !!data && !data.has_posted_today;

  async function handleSubmit(back: File, front: File, caption: string) {
    if (!user) return;
    setSubmitting(true);
    try {
      const { postId, items } = await publishOotd({ userId: user.id, back, front, caption });
      toast.success("Today’s OOTD posted.");
      setIsPostOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.feed(user.id) });
      if (items.length) setTagging({ postId, items });
    } catch (e) {
      toast.error(errorMessage(e, "Couldn’t post today’s OOTD."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="atelier-page max-w-2xl">
        <PageHeader
          className="mb-6 sm:mb-8"
          kicker="Community"
          title="Today’s looks."
          description="One outfit, one mirror, one mood — your community’s daily blueprints."
        />

        <Button size="lg" className="w-full sm:w-auto" onClick={() => setIsPostOpen(true)}>
          <Camera strokeWidth={1.75} aria-hidden="true" />
          Post today’s OOTD
        </Button>

        <div className="mt-8 sm:mt-10">
          {isLoading && (
            <div className="space-y-6" role="status" aria-label="Loading today’s looks">
              {[0, 1].map((i) => (
                <div key={i} className="atelier-card overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-4">
                    <Skeleton className="size-9 rounded-full" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-3 w-24 rounded-full" />
                      <Skeleton className="h-2.5 w-16 rounded-full" />
                    </div>
                  </div>
                  <Skeleton className="aspect-3/4" />
                </div>
              ))}
            </div>
          )}

          {isError && <LoadErrorPanel title="Feed couldn’t load." onRetry={() => refetch()} />}

          {!isLoading && !isError && locked && (
            <EmptyState
              role="status"
              className="mx-auto max-w-xl"
              icon={<Lock className="size-8" strokeWidth={1.25} />}
              title="Post today’s look to open the feed."
              description="The Atelier trades in kind — everyone here has shown their mirror today. Yours unlocks theirs."
            />
          )}

          {!isLoading && !isError && !locked && posts.length === 0 && (
            <EmptyState
              role="status"
              className="mx-auto max-w-xl"
              icon={<Images className="size-8" strokeWidth={1.25} />}
              title="You’re first to the mirror today."
              description="As your circle posts, their looks will land here."
            />
          )}

          {!isLoading && !locked && posts.length > 0 && (
            <Stagger className="space-y-6">
              {posts.map((p) => (
                <StaggerItem key={p.id}>
                  <PostCanvas post={p} />
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </div>
      </section>

      <Sheet open={isPostOpen} onOpenChange={(o) => !submitting && setIsPostOpen(o)}>
        <SheetContent side="bottom" className="max-h-[95vh] overflow-y-auto pt-8 pb-10">
          <SheetHeader className="mb-6 space-y-2 text-center">
            <SheetTitle className="font-serif text-2xl leading-snug">Post today’s OOTD</SheetTitle>
            <SheetDescription className="mx-auto max-w-md text-sm">
              Two captures, head to toe — your fit, then your face and hair.
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
