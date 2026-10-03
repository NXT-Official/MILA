import { ExternalLink, ImageOff } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { ProductCard } from "@/components/ui/product-card";
import { LookSection } from "@/components/dashboard/look-section";
import { formatPrice } from "@/lib/utils";
import type { ShoppablePick } from "@/lib/generate-outfit.functions";

export function ShopThisLookGrid({ items }: { items: ShoppablePick[] | null }) {
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
            as="a"
            href={item.affiliate_link}
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
                {item.source === "similar" ? `Similar · ${item.category}` : item.category}
              </p>
              <p className="font-serif text-sm leading-snug text-ink line-clamp-2">{item.title}</p>
              <p className="mt-1 atelier-label">{formatPrice(item.price, item.currency)}</p>
              <p className="mt-1 text-micro text-muted-foreground">
                {item.verification_status === "verified" && item.last_verified_at
                  ? `Last checked ${new Date(item.last_verified_at).toLocaleDateString()}`
                  : "Link not yet verified"}
              </p>
            </div>
            {/* Decorative — the whole card above is the real link (ProductCard as="a").
                A nested <a> here would be invalid HTML inside that anchor. */}
            <span className={buttonVariants({ size: "pill" })}>
              Shop
              <ExternalLink aria-hidden="true" strokeWidth={1.75} />
            </span>
          </ProductCard>
        ))}
      </div>
    </LookSection>
  );
}
