import { ExternalLink, ImageOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ProductCard,
  ProductCardCarouselTrack,
  ProductCardCarouselItem,
} from "@/components/ui/product-card";
import { cn, formatPrice } from "@/lib/utils";
import type { DupeHuntResult } from "@/lib/dupe-hunter.functions";

export function DupeHunterResults({
  loading,
  result,
  inspirationPreview,
  onReset,
}: {
  loading: boolean;
  result: DupeHuntResult | null;
  inspirationPreview: string | null;
  onReset: () => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <div className="relative size-16">
          <span className="absolute inset-0 rounded-full border border-accent/40 animate-ping" />
          <span className="absolute inset-2 rounded-full border border-accent/60 animate-pulse" />
          <Loader2
            className="absolute inset-0 m-auto size-5 text-accent animate-spin"
            strokeWidth={1.25}
          />
        </div>
        <p className="text-micro uppercase tracking-label-xwide text-muted-foreground">
          Scanning for luxury attributes…
        </p>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 rounded-control border border-border bg-canvas p-4">
        {inspirationPreview && (
          <img
            src={inspirationPreview}
            alt="Your inspiration"
            className="size-16 rounded-control object-cover border border-border"
          />
        )}
        <div className="min-w-0">
          <p className="text-nano uppercase tracking-label-xwide text-muted-foreground">
            Inspiration
          </p>
          <p className="font-serif text-base text-ink truncate">{result.inspiration.name}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {result.inspiration.silhouette_tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-nano uppercase tracking-label text-muted-foreground px-1.5 py-0.5 rounded-full border border-border"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-micro uppercase tracking-label-xwide text-muted-foreground">
          {result.dupes.length} budget alternatives
        </p>
        <button
          type="button"
          onClick={onReset}
          className="atelier-focus-ring rounded-control atelier-label hover:text-ink"
        >
          Hunt again
        </button>
      </div>

      {result.dupes.length > 0 ? (
        <ProductCardCarouselTrack aria-label="Budget alternatives">
          {result.dupes.map((d) => (
            <ProductCardCarouselItem key={d.id}>
              <ProductCard
                className="h-full"
                image={
                  <>
                    {d.image_url && (
                      <img
                        src={d.image_url}
                        alt={d.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          e.currentTarget.nextElementSibling?.classList.replace("hidden", "flex");
                        }}
                      />
                    )}
                    <div
                      className={cn(
                        "h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground",
                        d.image_url ? "hidden" : "flex",
                      )}
                    >
                      <ImageOff className="size-5" strokeWidth={1.5} />
                      <span className="text-micro uppercase tracking-label-xwide">
                        Image not available
                      </span>
                    </div>
                  </>
                }
              >
                <div className="flex-1">
                  <p className="font-serif text-sm text-ink leading-snug line-clamp-2">{d.title}</p>
                  <p className="mt-1 atelier-label">{formatPrice(d.price, d.currency)}</p>
                </div>
                {d.match_reasons[0] && (
                  <p className="text-micro text-muted-foreground line-clamp-2">
                    {d.match_reasons[0]}
                  </p>
                )}
                <p className="text-micro text-muted-foreground">
                  {d.verification_status === "verified" && d.last_verified_at
                    ? `Last checked ${new Date(d.last_verified_at).toLocaleDateString()}`
                    : "Link not yet verified"}
                </p>
                <Button asChild size="pill">
                  <a href={d.affiliate_link} target="_blank" rel="noopener noreferrer sponsored">
                    Shop the Dupe
                    <ExternalLink aria-hidden="true" strokeWidth={1.75} />
                  </a>
                </Button>
              </ProductCard>
            </ProductCardCarouselItem>
          ))}
        </ProductCardCarouselTrack>
      ) : (
        <div className="rounded-control border border-dashed border-border p-6 text-center">
          <p className="font-serif text-base text-ink">No close matches in the catalog yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try a cleaner background or a different angle.
          </p>
        </div>
      )}
    </div>
  );
}
