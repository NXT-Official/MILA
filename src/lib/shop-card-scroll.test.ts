import { describe, expect, test } from "bun:test";
import { scrollToShopCard, shopCardId } from "./shop-card-scroll";

function fakePage(reducedMotion: boolean, withCard = true) {
  const calls: string[] = [];
  const cardLink = {
    focus: (options?: { preventScroll?: boolean }) =>
      calls.push(`focus preventScroll=${options?.preventScroll}`),
  };
  const card = {
    scrollIntoView: (options?: { behavior?: string; block?: string }) =>
      calls.push(`scroll ${options?.behavior} ${options?.block}`),
    querySelector: (selector: string) => {
      calls.push(`query ${selector}`);
      return cardLink;
    },
  };
  return {
    calls,
    doc: {
      getElementById: (id: string) => {
        calls.push(`get ${id}`);
        return withCard ? card : null;
      },
    },
    prefersReducedMotion: () => reducedMotion,
  };
}

describe("scrollToShopCard", () => {
  test("a card's id is shop- and its pick id", () => {
    expect(shopCardId("coat-1")).toBe("shop-coat-1");
  });

  test("scrolls smoothly to the card and moves focus onto its link, URL untouched", () => {
    const page = fakePage(false);
    expect(scrollToShopCard("coat-1", page)).toBe(true);
    expect(page.calls).toEqual([
      "get shop-coat-1",
      "scroll smooth start",
      "query a[href]",
      "focus preventScroll=true",
    ]);
  });

  test("jumps without animation when she prefers reduced motion", () => {
    const page = fakePage(true);
    expect(scrollToShopCard("coat-1", page)).toBe(true);
    expect(page.calls).toContain("scroll auto start");
  });

  test("leaves the link to the browser when the card is not on the page", () => {
    const page = fakePage(false, false);
    expect(scrollToShopCard("gone", page)).toBe(false);
    expect(page.calls).toEqual(["get shop-gone"]);
  });
});
