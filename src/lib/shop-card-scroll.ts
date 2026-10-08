/**
 * The colour map's "See this piece" (Wave D, D-W7): bring that piece's Shop
 * card into view and put keyboard focus on its link, without touching the URL
 * (a hash change would make the router re-run the page's route). Smooth unless
 * she prefers reduced motion; the card's own scroll margin clears the phone's
 * sticky header. Returns false when the card is not on the page, so the
 * link's own `#shop-` jump runs instead.
 *
 * The page is injected so the behaviour is testable without a browser.
 */

type ScrollTarget = {
  scrollIntoView(options?: ScrollIntoViewOptions): void;
  querySelector(selectors: string): { focus(options?: FocusOptions): void } | null;
};

export type ShopCardPage = {
  doc: { getElementById(id: string): ScrollTarget | null };
  prefersReducedMotion: () => boolean;
};

/** The id each Shop card's wrapper carries (ShopThisLookGrid). */
export function shopCardId(pickId: string): string {
  return `shop-${pickId}`;
}

function browserPage(): ShopCardPage {
  return {
    doc: document,
    prefersReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

export function scrollToShopCard(pickId: string, page: ShopCardPage = browserPage()): boolean {
  const card = page.doc.getElementById(shopCardId(pickId));
  if (!card) return false;
  card.scrollIntoView({
    behavior: page.prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
  card.querySelector("a[href]")?.focus({ preventScroll: true });
  return true;
}
