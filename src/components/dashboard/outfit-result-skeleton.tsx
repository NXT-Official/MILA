import { Skeleton } from "@/components/ui/skeleton";
import { OutfitVisualPending } from "@/components/dashboard/outfit-visual";

function SkeletonSection({ compact }: { compact?: boolean }) {
  return (
    <div className="border-t border-border/70 pt-6 first:border-t-0 first:pt-0">
      <Skeleton className="h-2.5 w-16 rounded-full bg-foreground/6" />
      {compact ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-3 w-full rounded-full bg-foreground/6" />
          <Skeleton className="h-3 w-4/5 rounded-full bg-foreground/6" />
        </div>
      ) : (
        <>
          <Skeleton className="mt-3 h-5 w-2/3 rounded-full bg-foreground/6" />
          <div className="mt-4 space-y-2">
            <Skeleton className="h-3 w-full rounded-full bg-foreground/6" />
            <Skeleton className="h-3 w-full rounded-full bg-foreground/6" />
            <Skeleton className="h-3 w-3/4 rounded-full bg-foreground/6" />
          </div>
        </>
      )}
    </div>
  );
}

export function OutfitResultSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Creating your outfit and visual…</span>
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[42fr_58fr] md:gap-8">
        <div className="atelier-media-frame max-w-lg" aria-hidden="true">
          <OutfitVisualPending />
        </div>
        <div className="space-y-6" aria-hidden="true">
          <SkeletonSection />
          <SkeletonSection compact />
          <SkeletonSection compact />
        </div>
      </div>
      <div
        className="flex flex-wrap items-center gap-3 border-t border-border pt-5"
        aria-hidden="true"
      >
        <Skeleton className="h-10 w-36 rounded-full bg-foreground/6" />
        <Skeleton className="h-10 w-32 rounded-full bg-foreground/6" />
        <Skeleton className="h-10 w-32 rounded-full bg-foreground/6" />
      </div>
    </div>
  );
}
