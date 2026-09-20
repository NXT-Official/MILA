import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/constants/query-keys";
import { findSimilarItems, type DupeMatch } from "@/lib/dupe-hunter.functions";
import { sourceUrlHost, type PostItem } from "@/lib/outfit-items";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { profileQueryOptions } from "@/lib/queries/profile";

const MATCH_CACHE_MS = 24 * 60 * 60 * 1000;

export type ShopSort = "best_match" | "price_low" | "price_high";

export function sortMatches(matches: DupeMatch[], sort: ShopSort): DupeMatch[] {
  if (sort === "price_low") return [...matches].sort((a, b) => a.price - b.price);
  if (sort === "price_high") return [...matches].sort((a, b) => b.price - a.price);
  return matches;
}

export function PostItemDrawer({ item, onClose }: { item: PostItem | null; onClose: () => void }) {
  const fetchSimilar = useServerFn(findSimilarItems);
  const { user } = useAuth();
  const { data: profile } = useQuery({ ...profileQueryOptions(user?.id), enabled: !!user });
  const { data: similar, isLoading } = useQuery({
    queryKey: queryKeys.similarItems(item?.id ?? ""),
    queryFn: () =>
      fetchSimilar({
        data: { attributes: item!.attributes, region: profile?.delivery_country || undefined },
      }),
    enabled: !!item,
    staleTime: MATCH_CACHE_MS,
    gcTime: MATCH_CACHE_MS,
  });
  const [sort, setSort] = useState<ShopSort>("best_match");
  const sortedMatches = useMemo(() => sortMatches(similar ?? [], sort), [similar, sort]);

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

                {isLoading && (
                  <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="aspect-3/4 rounded-card" />
                    <Skeleton className="aspect-3/4 rounded-card" />
                  </div>
                )}

                {!isLoading && !sortedMatches.length && (
                  <div className="rounded-card border border-dashed border-border p-6 text-center">
                    <p className="font-serif text-base text-ink">
                      Nothing close in the catalog yet.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Mila's shelf grows every week — check back on this piece.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {sortedMatches.map((match) => (
                    <ProductCard
                      key={match.id}
                      as="a"
                      href={match.affiliate_link}
                      image={
                        <>
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
                          {match.title}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <p className="atelier-label">
                            {formatPrice(match.price, match.currency)}
                            {/* TODO: not yet implemented — convert to viewer's currency via a real FX source; currently displays the product's stored currency as-is */}
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
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
