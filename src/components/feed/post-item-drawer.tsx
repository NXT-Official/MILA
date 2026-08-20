import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, ImageOff } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/constants/query-keys";
import { findSimilarItems } from "@/lib/dupe-hunter.functions";
import { sourceUrlHost, type PostItem } from "@/lib/outfit-items";
import { formatPrice } from "@/lib/utils";

const MATCH_CACHE_MS = 24 * 60 * 60 * 1000;

export function PostItemDrawer({ item, onClose }: { item: PostItem | null; onClose: () => void }) {
  const fetchSimilar = useServerFn(findSimilarItems);
  const { data: similar, isLoading } = useQuery({
    queryKey: queryKeys.similarItems(item?.id ?? ""),
    queryFn: () => fetchSimilar({ data: { attributes: item!.attributes } }),
    enabled: !!item,
    staleTime: MATCH_CACHE_MS,
    gcTime: MATCH_CACHE_MS,
  });

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto pt-8 pb-10">
        {item && (
          <div className="max-w-md mx-auto space-y-6">
            <SheetHeader className="text-center space-y-2">
              <p className="text-xs text-muted-foreground">{item.category}</p>
              <SheetTitle className="font-serif text-2xl leading-snug">{item.label}</SheetTitle>
              <SheetDescription className="text-sm">
                {item.attributes.primary_color} · {item.attributes.silhouette_tags.join(" · ")}
              </SheetDescription>
            </SheetHeader>

            {item.source_url && (
              <a
                href={item.source_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="atelier-focus-ring flex items-center justify-between gap-3 rounded-panel border border-line bg-canvas px-5 py-4 transition-colors hover:bg-accent-soft/40"
              >
                <span className="min-w-0">
                  <span className="block text-xs text-muted-foreground">
                    Poster’s link
                    <span className="sr-only"> (opens in a new tab)</span>
                  </span>
                  <span className="block font-serif text-base text-ink truncate">
                    {sourceUrlHost(item.source_url)}
                  </span>
                </span>
                <ExternalLink className="size-4 shrink-0 text-stone" strokeWidth={1.75} />
              </a>
            )}

            <div className="space-y-3">
              <p className="atelier-section-label">Similar pieces</p>

              {isLoading && (
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="aspect-3/4 rounded-card" />
                  <Skeleton className="aspect-3/4 rounded-card" />
                </div>
              )}

              {!isLoading && !similar?.length && (
                <div className="rounded-panel border border-dashed border-line p-6 text-center">
                  <p className="font-serif text-base text-ink">Nothing close in the catalog yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Mila’s shelf grows every week — check back on this piece.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {(similar ?? []).map((match) => (
                  <a
                    key={match.id}
                    href={match.affiliate_link}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="atelier-focus-ring flex flex-col overflow-hidden rounded-card border border-line bg-surface transition-colors hover:border-accent"
                  >
                    <div className="aspect-3/4 bg-atelier-ivory/60 overflow-hidden">
                      <ImageWithFallback
                        src={match.image_url}
                        alt={match.title}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        fallback={
                          <div className="h-full w-full flex items-center justify-center text-stone">
                            <ImageOff className="size-5" strokeWidth={1.5} />
                          </div>
                        }
                      />
                    </div>
                    <div className="p-3">
                      <p className="line-clamp-2 text-sm leading-snug text-ink">{match.title}</p>
                      <p className="mt-1 text-sm font-medium text-ink tabular-nums">
                        {formatPrice(match.price, match.currency)}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
