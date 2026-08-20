import { ImageOff, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Fills an `atelier-media-frame` while the visual is being drawn. */
export function OutfitVisualPending() {
  return (
    <>
      <Skeleton className="absolute inset-0 bg-foreground/4" />
      <div className="relative flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Drawing your look…</p>
      </div>
    </>
  );
}

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
      <div className="atelier-media-frame max-w-lg" role="status">
        <OutfitVisualPending />
      </div>
    );
  }

  if (imageDataUri) {
    return (
      <div className="atelier-media-frame max-w-lg">
        <img
          src={imageDataUri}
          alt={`AI-generated visualization of ${headline}`}
          className="h-full w-full object-contain bg-foreground/4"
        />
      </div>
    );
  }

  return (
    <div className="atelier-media-frame max-w-lg">
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <ImageOff className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          {imageGenerationError ?? "The outfit is ready, but the visual could not be generated."}
        </p>
        {onRetry ? (
          <Button variant="outline" size="pill" onClick={onRetry} disabled={retryDisabled}>
            <RotateCcw aria-hidden="true" />
            Retry visual
          </Button>
        ) : null}
      </div>
    </div>
  );
}
