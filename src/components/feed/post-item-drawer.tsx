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

function formatPrice(price: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    return `${currency} ${price}`;
  }
}

// The catalog and the piece's attributes are both fixed, so today's matches are
// still tomorrow's. ponytail: per-browser rather than a shared cache table —
// matching is one indexed query with no AI call behind it.
const MATCH_CACHE_MS = 24 * 60 * 60 * 1000;

/**
 * Opened by tapping a hotspot. Shows the piece, wherever the poster said it's
 * from, and visually similar items.
 */
export function PostItemDrawer({ item, onClose }: { item: PostItem | null; onClose: () => void }) {
  const fetchSimilar = useServerFn(findSimilarItems);
  // Only on open: most viewers never tap most hotspots.
  const { data: similar, isLoading } = useQuery({
    queryKey: queryKeys.similarItems(item?.id ?? ""),
    queryFn: () => fetchSimilar({ data: { attributes: item!.attributes } }),
    enabled: !!item,
    staleTime: MATCH_CACHE_MS,
    gcTime: MATCH_CACHE_MS,
  });

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl border-t border-porcelain/60 px-6 pt-8 pb-10 max-h-[85vh] overflow-y-auto"
      >
        {item && (
          <div className="max-w-md mx-auto space-y-6">
            <SheetHeader className="text-center space-y-2">
              <p className="text-micro uppercase tracking-label-max text-muted-foreground">
                {item.category}
              </p>
              <SheetTitle className="font-serif text-3xl leading-tight">{item.label}</SheetTitle>
              <SheetDescription className="text-sm">
                {item.attributes.primary_color} · {item.attributes.silhouette_tags.join(" · ")}
              </SheetDescription>
            </SheetHeader>

            {item.source_url && (
              <a
                href={item.source_url}
                target="_blank"
                // nofollow because the destination is poster-supplied and unvetted.
                rel="noopener noreferrer nofollow"
                className="atelier-focus-ring flex items-center justify-between gap-3 rounded-2xl atelier-glass px-5 py-4"
              >
                <span className="min-w-0">
                  <span className="block text-nano uppercase tracking-label-xwide text-stone">
                    Poster's link
                  </span>
                  {/* The hostname, never the raw URL: a long path can otherwise be
                      dressed up to look like it points at another domain. */}
                  <span className="block font-serif text-base text-ink truncate">
                    {sourceUrlHost(item.source_url)}
                  </span>
                </span>
                <ExternalLink className="size-4 shrink-0 text-stone" strokeWidth={1.75} />
              </a>
            )}

            <div className="space-y-3">
              <p className="text-micro uppercase tracking-label-xwide text-muted-foreground">
                Similar pieces
              </p>

              {isLoading && (
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="aspect-3/4 rounded-2xl bg-porcelain/20" />
                  <Skeleton className="aspect-3/4 rounded-2xl bg-porcelain/20" />
                </div>
              )}

              {!isLoading && !similar?.length && (
                <div className="rounded-2xl border border-dashed border-porcelain/60 p-6 text-center">
                  <p className="font-serif text-base text-ink">Nothing close in the catalog yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Mila's shelf grows every week — check back on this piece.
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
                    className="atelier-focus-ring rounded-2xl atelier-glass overflow-hidden flex flex-col shadow-atelier-soft"
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
                      <p className="font-serif text-sm text-ink leading-snug line-clamp-2">
                        {match.title}
                      </p>
                      <p className="mt-1 atelier-label">
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
