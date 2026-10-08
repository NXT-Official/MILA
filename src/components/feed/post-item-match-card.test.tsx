import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { DupeMatch } from "@/lib/dupe-hunter.functions";
import { savedProductsQueryKey } from "@/lib/queries/saved-products";
import { asMarkup, renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { SimilarMatchCard } from "./post-item-drawer";

function match(overrides: Partial<DupeMatch>): DupeMatch {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Gold Hoop Earrings",
    brand_id: "b1",
    category: "Jewelry",
    price: 28,
    currency: "USD",
    image_url: "https://cdn.example.com/hoops.jpg",
    affiliate_link: "https://shop.example.com/hoops",
    description: null,
    match_score: 0.8,
    match_reasons: [],
    verification_status: "unverified",
    last_verified_at: null,
    rating: 4.6,
    units_sold: 120,
    shipping_info: "Free shipping",
    discount_percent: 20,
    is_verified_seller: true,
    ...overrides,
  };
}

describe("SimilarMatchCard in the post drawer's Shop tab", () => {
  test("names the piece with a badge, the alt text and the text line", async () => {
    const out = await renderAppMarkup(<SimilarMatchCard match={match({})} postItemId="pi-1" />);
    expect(out).toContain(">Earrings</span>");
    expect(out).toContain(
      `alt="${asMarkup("Gold Hoop Earrings. Mila is recommending the earrings")}"`,
    );
    expect(out).toContain(asMarkup("Earrings: Gold Hoop Earrings"));
  });

  test("the discount badge stays top-left and the garment badge sits bottom-left", async () => {
    const out = await renderAppMarkup(<SimilarMatchCard match={match({})} postItemId="pi-1" />);
    expect(out).toMatch(/absolute top-2 left-2[^"]*">-20%<\/span>/);
    expect(out).toMatch(/absolute bottom-2 left-2[^>]*>.*Earrings<\/span>/);
  });

  test("keeps the shop metadata it showed before", async () => {
    const out = await renderAppMarkup(<SimilarMatchCard match={match({})} postItemId="pi-1" />);
    expect(out).toContain('aria-label="Verified seller"');
    expect(out).toContain("4.6");
    expect(out).toContain("120 sold");
    expect(out).toContain("Free shipping");
    expect(out).toContain("Link not yet verified");
    expect(out).toContain('href="https://shop.example.com/hoops"');
  });

  test("a signed-in member can save the match; the button sits outside the link", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(savedProductsQueryKey("user-1"), { status: "ready", items: [] });
    const out = await renderAppMarkup(<SimilarMatchCard match={match({})} postItemId="pi-1" />, {
      userId: "user-1",
      queryClient,
    });
    const anchor = out.slice(out.indexOf("<a "), out.indexOf("</a>") + 4);
    expect(anchor).not.toContain("<button");
    expect(out).toContain(`aria-label="${asMarkup("Save Gold Hoop Earrings")}"`);
  });

  test("a match with no photo still shows its badge", async () => {
    const out = await renderAppMarkup(
      <SimilarMatchCard match={match({ image_url: null })} postItemId="pi-1" />,
    );
    expect(out).toContain(">Earrings</span>");
  });
});
