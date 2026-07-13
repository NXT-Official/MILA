import { Loader2 } from "lucide-react";

function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`h-3 animate-pulse rounded-full bg-foreground/8 ${className}`} />;
}

function SkeletonCard({ compact }: { compact?: boolean }) {
  return (
    <div className="rounded-card border border-border bg-card p-5 md:p-6 shadow-paper">
      <SkeletonBar className="h-2.5 w-16" />
      {compact ? (
        <div className="mt-4 space-y-2">
          <SkeletonBar className="w-full" />
          <SkeletonBar className="w-4/5" />
        </div>
      ) : (
        <>
          <SkeletonBar className="mt-3 h-5 w-2/3" />
          <div className="mt-4 space-y-2">
            <SkeletonBar className="w-full" />
            <SkeletonBar className="w-full" />
            <SkeletonBar className="w-3/4" />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Full two-column skeleton shown only while Gemini itself is still
 * composing (before there's any written outfit to show). Mirrors the real
 * result's structure so the layout doesn't jump once content arrives.
 */
export function OutfitResultSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Creating your outfit and visual…</span>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[42fr_58fr] lg:gap-8">
        <div
          className="relative mx-auto aspect-square w-full max-w-lg overflow-hidden rounded-card border border-border bg-card shadow-paper"
          aria-hidden="true"
        >
          <div className="absolute inset-0 animate-pulse bg-accent-soft/50" />
          <div className="relative flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Loader2 className="size-5 animate-spin text-accent" />
            <p className="font-serif text-lg text-foreground">Visualizing your look…</p>
            <p className="text-xs text-muted-foreground">
              Creating your personalized outfit visual.
            </p>
          </div>
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
        <div className="h-10 w-36 animate-pulse rounded-full bg-foreground/8" />
        <div className="h-10 w-32 animate-pulse rounded-full bg-foreground/8" />
        <div className="h-10 w-32 animate-pulse rounded-full bg-foreground/8" />
      </div>
    </div>
  );
}
