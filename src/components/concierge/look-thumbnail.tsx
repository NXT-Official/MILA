import { Shirt } from "lucide-react";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";

export function LookThumbnail({ imageUrl, title }: { imageUrl: string | null; title: string }) {
  return (
    <ImageWithFallback
      src={imageUrl}
      alt={`Anchored look: ${title}`}
      className="h-full w-full object-cover"
      fallback={
        <div className="h-full w-full flex items-center justify-center text-muted-foreground">
          <Shirt className="size-5" strokeWidth={1.25} aria-hidden="true" />
        </div>
      }
    />
  );
}
