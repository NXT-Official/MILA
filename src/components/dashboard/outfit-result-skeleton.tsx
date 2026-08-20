import { Skeleton } from "@/components/ui/skeleton";
import { OutfitVisualPending } from "@/components/dashboard/outfit-visual";

function SkeletonCard({ compact }: { compact?: boolean }) {
  return (
    <div className="rounded-card border border-border bg-card p-5 md:p-6">
      <Skeleton className="rounded-full bg-foreground/8 h-2.5 w-16" />
      {compact ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-3 rounded-full bg-foreground/8 w-full" />
          <Skeleton className="h-3 rounded-full bg-foreground/8 w-4/5" />
        </div>
      ) : (
        <>
          <Skeleton className="rounded-full bg-foreground/8 mt-3 h-5 w-2/3" />
          <div className="mt-4 space-y-2">
            <Skeleton className="h-3 rounded-full bg-foreground/8 w-full" />
            <Skeleton className="h-3 rounded-full bg-foreground/8 w-full" />
            <Skeleton className="h-3 rounded-full bg-foreground/8 w-3/4" />
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
        <div className="space-y-4" aria-hidden="true">
          <SkeletonCard />
          <SkeletonCard compact />
          <SkeletonCard compact />
        </div>
      </div>
      <div
        className="flex flex-wrap items-center gap-3 border-t border-border pt-5"
        aria-hidden="true"
      >
        <Skeleton className="h-10 w-36 rounded-full bg-foreground/8" />
        <Skeleton className="h-10 w-32 rounded-full bg-foreground/8" />
        <Skeleton className="h-10 w-32 rounded-full bg-foreground/8" />
      </div>
    </div>
  );
}
