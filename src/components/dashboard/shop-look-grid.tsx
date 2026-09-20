import { ExternalLink, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductCard } from "@/components/ui/product-card";
import { LookSection } from "@/components/dashboard/look-section";
import { formatPrice } from "@/lib/utils";
import type { LookProduct } from "@/lib/look-products.functions";

export function ShopThisLookGrid({ items }: { items: LookProduct[] | null }) {
  if (!items) return null;

  if (items.length === 0) {
    return (
      <LookSection kicker="Shop This Look">
        <p className="text-sm text-muted-foreground">No verified matching item found.</p>
      </LookSection>
    );
  }

  return (
    <LookSection kicker="Shop This Look">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((item) => (
          <ProductCard
            key={item.id}
            image={
              item.image_url ? (
                <img
                  src={item.image_url}
                  alt={item.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <ImageOff className="size-5" strokeWidth={1.5} aria-hidden="true" />
                  <span className="text-micro uppercase tracking-label-xwide">
                    Image not available
                  </span>
                </div>
              )
            }
          >
            <div className="flex-1">
              <p className="text-micro uppercase tracking-label text-muted-foreground">
                {item.category}
              </p>
              <p className="font-serif text-sm leading-snug text-ink line-clamp-2">{item.title}</p>
              <p className="mt-1 atelier-label">{formatPrice(item.price, item.currency)}</p>
              <p className="mt-1 text-micro text-muted-foreground">
                {item.verification_status === "verified" && item.last_verified_at
                  ? `Last checked ${new Date(item.last_verified_at).toLocaleDateString()}`
                  : "Link not yet verified"}
              </p>
            </div>
            <Button asChild size="pill">
              <a href={item.affiliate_link} target="_blank" rel="noopener noreferrer sponsored">
                Shop
                <ExternalLink aria-hidden="true" strokeWidth={1.75} />
              </a>
            </Button>
          </ProductCard>
        ))}
      </div>
    </LookSection>
  );
}
