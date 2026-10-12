import { ExternalLink, ImageOff } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { ProductCard } from "@/components/ui/product-card";
import { GarmentOverlay } from "@/components/ui/garment-overlay";
import { SaveProductButton } from "@/components/ui/save-product-button";
import { ColourMapPanel } from "@/components/dashboard/colour-map-panel";
import { LookSection } from "@/components/dashboard/look-section";
import { SavedPiecesLink } from "@/components/saved/saved-pieces-link";
import { garmentFor, garmentLine, recommendationAlt } from "@/lib/garment-label";
import { shopCardId } from "@/lib/shop-card-scroll";
import { formatPrice } from "@/lib/utils";
import { colourMapRows } from "@/lib/wear-colour";
import type { ShoppablePick } from "@/lib/generate-outfit.functions";

export function ShopThisLookGrid({
  items,
  outfitId = null,
}: {
  items: ShoppablePick[] | null;
  /** The saved look these picks belong to, when there is one; linked on Save. */
  outfitId?: string | null;
}) {
  if (!items) return null;

  if (items.length === 0) {
    return (
      <LookSection kicker="Shop This Look">
        <p className="text-sm text-muted-foreground">No verified matching item found.</p>
      </LookSection>
    );
  }

  return (
    <div className="space-y-6">
      {/* Which of her colours to wear each piece in (Wave D, R6); each row links to its card below. */}
      <ColourMapPanel rows={colourMapRows(items)} linkToCards />
      <LookSection kicker="Shop This Look">
        {/* The lasting way back to her bookmarks on a phone, where the sidebar is hidden. */}
        <SavedPiecesLink className="-mt-2 mb-1 -mr-2 ml-auto flex w-fit" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => {
            const garment = garmentFor(item.category, item.title);
            return (
              // The colour map's "See this piece" target; scroll-mt clears the phone's sticky header.
              <div key={item.id} id={shopCardId(item.id)} className="h-full scroll-mt-20">
                <ProductCard
                  as="a"
                  href={item.affiliate_link}
                  overlay={<GarmentOverlay garment={garment} wear={item.wear_colour} />}
                  actions={
                    <SaveProductButton product={item} context={{ source: "look", outfitId }} />
                  }
                  image={
                    item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={recommendationAlt(item.title, garment)}
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
                    <p className="font-serif text-sm leading-snug text-ink line-clamp-2">
                      {garmentLine(garment, item.title)}
                    </p>
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
              </div>
            );
          })}
        </div>
      </LookSection>
    </div>
  );
}
