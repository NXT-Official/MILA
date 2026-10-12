import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ExternalLink, ImageOff, Star, Truck } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { ProductCard } from "@/components/ui/product-card";
import { GarmentBadge } from "@/components/ui/garment-badge";
import { SaveProductButton } from "@/components/ui/save-product-button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DupeMatch } from "@/lib/dupe-hunter.functions";
import {
  prefetchSimilarItems,
  similarItemsQueryOptions,
  similarShopView,
  useSimilarItemsInputs,
} from "@/lib/queries/similar-items";
import { garmentFor, garmentLine, recommendationAlt } from "@/lib/garment-label";
import { sourceUrlHost, type PostItem } from "@/lib/outfit-items";
import { formatPrice } from "@/lib/utils";
import { sortMatches, type ShopSort } from "@/lib/sort-matches";

/** One catalog match in the Shop tab, named by its garment badge. */
export function SimilarMatchCard({ match, postItemId }: { match: DupeMatch; postItemId: string }) {
  const garment = garmentFor(match.category, match.title);
  return (
    <ProductCard
      as="a"
      href={match.affiliate_link}
      overlay={<GarmentBadge garment={garment} />}
      actions={<SaveProductButton product={match} context={{ source: "post_item", postItemId }} />}
      image={
        <>
          <ImageWithFallback
            src={match.image_url}
            alt={recommendationAlt(match.title, garment)}
            loading="lazy"
            className="h-full w-full object-cover"
            fallback={
              <div className="h-full w-full flex items-center justify-center text-stone">
                <ImageOff className="size-5" strokeWidth={1.5} />
              </div>
            }
          />
          {!!match.discount_percent && (
            <span className="absolute top-2 left-2 rounded-full bg-ink/90 px-2 py-0.5 text-nano font-medium uppercase tracking-label-wide text-surface">
              -{match.discount_percent}%
            </span>
          )}
        </>
      }
    >
      <div className="space-y-1">
        <p className="font-serif text-sm text-ink leading-snug line-clamp-2">
          {garmentLine(garment, match.title)}
        </p>
        <div className="flex items-center gap-1.5">
          <p className="atelier-label">
            {formatPrice(match.price, match.currency)}
            {/* Prices render in the product's stored currency, labelled by formatPrice (Intl). FX conversion to a viewer currency is deliberately out of scope until a real rate source exists (Morpessa MW-9 resolved as "labelled"). */}
          </p>
          {match.is_verified_seller && (
            <BadgeCheck
              className="size-3.5 text-accent"
              strokeWidth={1.75}
              aria-label="Verified seller"
            />
          )}
        </div>
        {(match.rating != null || match.units_sold != null) && (
          <p className="flex items-center gap-1 text-micro text-muted-foreground">
            {match.rating != null && (
              <span className="flex items-center gap-0.5">
                <Star className="size-3 fill-current" strokeWidth={0} />
                {match.rating.toFixed(1)}
              </span>
            )}
            {match.rating != null && match.units_sold != null && <span>·</span>}
            {match.units_sold != null && <span>{match.units_sold} sold</span>}
          </p>
        )}
        {match.shipping_info && (
          <p className="flex items-center gap-1 text-micro text-muted-foreground">
            <Truck className="size-3" strokeWidth={1.75} />
            {match.shipping_info}
          </p>
        )}
        <p className="text-micro text-muted-foreground">
          {match.verification_status === "verified" && match.last_verified_at
            ? `Last checked ${new Date(match.last_verified_at).toLocaleDateString()}`
            : "Link not yet verified"}
        </p>
      </div>
    </ProductCard>
  );
}

/** Empty or error state for the Shop tab: a failed search must never read as "no matches". */
export function SimilarShopNotice({
  isError,
  onRetry,
  isRetrying = false,
}: {
  isError: boolean;
  onRetry: () => void;
  isRetrying?: boolean;
}) {
  if (isError) {
    return (
      <div role="alert" className="rounded-card border border-dashed border-border p-6 text-center">
        <p className="font-serif text-base text-ink">We couldn't search the catalog just now.</p>
        <p className="mt-1 text-xs text-muted-foreground">Nothing is wrong with the piece.</p>
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          aria-busy={isRetrying}
          className="atelier-focus-ring mt-3 inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm text-ink hover:bg-secondary disabled:opacity-60"
        >
          {isRetrying ? "Searching again..." : "Try again"}
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-card border border-dashed border-border p-6 text-center">
      <p className="font-serif text-base text-ink">Nothing close in the catalog yet.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Mila's shelf grows every week. Check back on this piece.
      </p>
    </div>
  );
}

/** Shop tab results: loading, error (with retry), empty, or the matches. */
export function SimilarShopResults({ item, sort }: { item: PostItem; sort: ShopSort }) {
  const { fetchSimilar, region, settled } = useSimilarItemsInputs();
  const {
    data: similar,
    status,
    isFetching,
    refetch,
  } = useQuery(similarItemsQueryOptions(item, fetchSimilar, { region, settled }));
  const sortedMatches = useMemo(() => sortMatches(similar ?? [], sort), [similar, sort]);
  const view = similarShopView({ settled, status, count: sortedMatches.length });

  return (
    <>
      {view === "loading" && (
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="aspect-3/4 rounded-card" />
          <Skeleton className="aspect-3/4 rounded-card" />
        </div>
      )}

      {(view === "error" || view === "empty") && (
        <SimilarShopNotice
          isError={view === "error"}
          isRetrying={isFetching}
          onRetry={() => void refetch()}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        {sortedMatches.map((match) => (
          <SimilarMatchCard key={match.id} match={match} postItemId={item.id} />
        ))}
      </div>
    </>
  );
}

export function PostItemDrawer({ item, onClose }: { item: PostItem | null; onClose: () => void }) {
  const [sort, setSort] = useState<ShopSort>("best_match");
  const queryClient = useQueryClient();
  const { fetchSimilar, region, settled } = useSimilarItemsInputs();
  useEffect(() => {
    void prefetchSimilarItems(queryClient, item, fetchSimilar, { region, settled });
  }, [queryClient, item, fetchSimilar, region, settled]);

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="px-6 pt-8 pb-10 max-h-[85vh] overflow-y-auto">
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

            <Tabs defaultValue="top" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="top" className="flex-1">
                  Top
                </TabsTrigger>
                <TabsTrigger value="shop" className="flex-1">
                  Shop
                </TabsTrigger>
              </TabsList>

              <TabsContent value="top" className="space-y-3">
                {item.source_url ? (
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="atelier-focus-ring flex items-center justify-between gap-3 rounded-card border border-border bg-card px-5 py-4"
                  >
                    <span className="min-w-0">
                      <span className="block text-nano uppercase tracking-label-xwide text-stone">
                        Poster's link
                      </span>
                      <span className="block font-serif text-base text-ink truncate">
                        {sourceUrlHost(item.source_url)}
                      </span>
                    </span>
                    <ExternalLink className="size-4 shrink-0 text-stone" strokeWidth={1.75} />
                  </a>
                ) : (
                  <div className="rounded-card border border-dashed border-border p-6 text-center">
                    <p className="font-serif text-base text-ink">
                      The poster didn't tag a link for this piece.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Check the Shop tab for close matches from the catalog.
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="shop" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-micro uppercase tracking-label-xwide text-muted-foreground">
                    Similar pieces
                  </p>
                  <Select value={sort} onValueChange={(v) => setSort(v as ShopSort)}>
                    <SelectTrigger className="h-8 w-auto gap-1.5 px-2.5 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="best_match">Best match</SelectItem>
                      <SelectItem value="price_low">Price: low to high</SelectItem>
                      <SelectItem value="price_high">Price: high to low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <SimilarShopResults item={item} sort={sort} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
