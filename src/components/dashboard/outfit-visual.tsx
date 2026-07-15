import { ImageOff, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OutfitVisual({
  imageDataUri,
  imageGenerationError,
  loading,
  headline,
  onRetry,
  retryDisabled,
}: {
  imageDataUri: string | null;
  imageGenerationError?: string;
  loading: boolean;
  headline: string;
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  if (loading) {
    return (
      <div
        className="relative mx-auto aspect-square w-full max-w-lg overflow-hidden rounded-card border border-border bg-card shadow-paper"
        role="status"
      >
        <div className="absolute inset-0 animate-pulse bg-accent-soft/50" />
        <div className="relative flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <Loader2 className="size-5 animate-spin text-accent" aria-hidden="true" />
          <p className="font-serif text-lg text-foreground">Visualizing your look…</p>
          <p className="text-xs text-muted-foreground">Creating your personalized outfit visual.</p>
        </div>
      </div>
    );
  }

  if (imageDataUri) {
    return (
      <div className="relative mx-auto aspect-square w-full max-w-lg overflow-hidden rounded-card border border-border bg-card shadow-paper">
        <img
          src={imageDataUri}
          alt={`AI-generated visualization of ${headline}`}
          className="h-full w-full object-contain bg-foreground/4"
        />
      </div>
    );
  }

  return (
    <div className="relative mx-auto aspect-square w-full max-w-lg overflow-hidden rounded-card border border-border bg-card shadow-paper">
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <ImageOff className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          {imageGenerationError ?? "The outfit is ready, but the visual could not be generated."}
        </p>
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={retryDisabled}
            className="rounded-full uppercase tracking-[0.18em] text-[11px]"
          >
            <RotateCcw className="size-3.5 mr-2" aria-hidden="true" />
            Retry visual
          </Button>
        ) : null}
      </div>
    </div>
  );
}
