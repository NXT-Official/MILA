import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bookmark, ExternalLink, ImageOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorPanel } from "@/components/ui/error-state";
import { GarmentBadge } from "@/components/ui/garment-badge";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { ProductCard } from "@/components/ui/product-card";
import { Skeleton } from "@/components/ui/skeleton";
import { garmentLine, recommendationAlt, type Garment } from "@/lib/garment-label";
import {
  groupSavedByKind,
  savedAvailability,
  type SavedAvailability,
  type SavedProduct,
  type SavedProductSource,
  type SavedProductsState,
} from "@/lib/queries/saved-products";
import { cn, formatPrice, relativeTime } from "@/lib/utils";

const SOURCE_LABELS: Record<SavedProductSource, string> = {
  look: "From your look",
  dupe: "From Dupe Hunter",
  post_item: "From the feed",
};

const STATUS_LABELS: Record<Exclude<SavedAvailability, "available">, string> = {
  gone: "No longer available",
  out_of_stock: "Out of stock",
  link_unavailable: "Link unavailable",
};

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4";

function SavedPieceCard({
  item,
  garment,
  onRemove,
}: {
  item: SavedProduct;
  garment: Garment;
  onRemove: (item: SavedProduct) => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);
  const { snapshot } = item;
  const availability = savedAvailability(item);
  const shopUrl = availability === "available" ? (item.live?.affiliate_link ?? null) : null;

  return (
    <div data-saved-piece="" className="h-full">
      <ProductCard
        overlay={<GarmentBadge garment={garment} />}
        image={
          <ImageWithFallback
            src={snapshot.image_url}
            alt={recommendationAlt(snapshot.title, garment)}
            loading="lazy"
            className={cn(
              "h-full w-full object-cover",
              availability !== "available" && "opacity-60 grayscale",
            )}
            fallback={
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <ImageOff className="size-5" strokeWidth={1.5} aria-hidden="true" />
                <span className="text-micro uppercase tracking-label-xwide">
                  Image not available
                </span>
              </div>
            }
          />
        }
      >
        <div className="flex-1 space-y-1">
          <p className="text-micro uppercase tracking-label text-muted-foreground">
            {SOURCE_LABELS[item.source]}
          </p>
          <p className="font-serif text-sm leading-snug text-ink line-clamp-2">
            {garmentLine(garment, snapshot.title)}
          </p>
          {snapshot.brand && <p className="text-xs text-muted-foreground">{snapshot.brand}</p>}
          {snapshot.price != null && snapshot.currency && (
            <p className="atelier-label">{formatPrice(snapshot.price, snapshot.currency)}</p>
          )}
          {availability !== "available" && (
            <p className="text-xs font-medium text-ink">{STATUS_LABELS[availability]}</p>
          )}
          <p className="text-micro text-muted-foreground">Saved {relativeTime(item.created_at)}</p>
        </div>
        <div className="flex flex-col gap-2">
          {shopUrl && (
            <a
              href={shopUrl}
              target="_blank"
              rel="noopener noreferrer sponsored"
              aria-label={`Shop ${snapshot.title}`}
              className={buttonVariants({ size: "pill" })}
            >
              Shop
              <ExternalLink aria-hidden="true" strokeWidth={1.75} />
            </a>
          )}
          <Button
            variant="outline"
            size="pill"
            loading={removing}
            aria-label={`Remove ${snapshot.title}`}
            onClick={async () => {
              setRemoving(true);
              try {
                await onRemove(item);
              } finally {
                setRemoving(false);
              }
            }}
            className="text-xs"
          >
            {removing ? null : <Trash2 className="size-4" aria-hidden="true" />}
            Remove
          </Button>
        </div>
      </ProductCard>
    </div>
  );
}

export function SavedPiecesView({
  state,
  isLoading,
  isError,
  onRetry,
  onRemove,
}: {
  state: SavedProductsState | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onRemove: (item: SavedProduct) => Promise<void>;
}) {
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading saved pieces" className={GRID}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="aspect-3/4 rounded-control" />
            <Skeleton className="h-4 w-3/4 rounded-control" />
            <Skeleton className="h-4 w-1/2 rounded-control" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return <LoadErrorPanel title="Couldn't load your saved pieces" onRetry={onRetry} />;
  }

  if (state?.status === "unavailable") {
    return (
      <EmptyState
        role="status"
        className="mx-auto max-w-xl"
        icon={<Bookmark className="size-8" strokeWidth={1.25} />}
        title="Saved pieces are almost ready"
        description="Saving recommended pieces is not switched on yet. Your looks and palettes are all still here."
      />
    );
  }

  const items = state?.status === "ready" ? state.items : [];
  if (!items.length) {
    return (
      <EmptyState
        role="status"
        className="mx-auto max-w-xl"
        icon={<Bookmark className="size-8" strokeWidth={1.25} />}
        title="Nothing saved yet"
        description="Tap the bookmark on any piece Mila recommends and it will wait here."
        action={
          <Link to="/dashboard" className={buttonVariants({ variant: "secondary", size: "pill" })}>
            Find a look
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-10">
      {groupSavedByKind(items).map((group) => (
        <section key={group.kind} aria-labelledby={`saved-${group.kind}`} className="space-y-4">
          <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
            <h2 id={`saved-${group.kind}`} className="font-serif text-xl text-ink">
              {group.heading}
            </h2>
            <span className="atelier-label">
              {group.items.length} {group.items.length === 1 ? "piece" : "pieces"}
            </span>
          </div>
          <div className={GRID}>
            {group.items.map(({ item, garment }) => (
              <SavedPieceCard key={item.id} item={item} garment={garment} onRemove={onRemove} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
