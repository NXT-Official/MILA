import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { ShoppablePick } from "@/lib/generate-outfit.functions";
import { savedProductsQueryKey } from "@/lib/queries/saved-products";
import { asMarkup, renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { ShopThisLookGrid } from "./shop-look-grid";

function pick(overrides: Partial<ShoppablePick>): ShoppablePick {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "High Rise Straight Jeans",
    brand_id: "b1",
    category: "Bottoms",
    price: 79,
    currency: "USD",
    image_url: "https://cdn.example.com/jeans.jpg",
    affiliate_link: "https://shop.example.com/jeans",
    verification_status: "verified",
    last_verified_at: "2026-10-01T00:00:00Z",
    rationale: "Balances the volume up top.",
    source: "planned",
    ...overrides,
  };
}

describe("ShopThisLookGrid names the piece Mila is recommending", () => {
  test("a badge over the photo says which garment it is", async () => {
    const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({})]} />);
    expect(out).toContain("bg-ink/90");
    expect(out).toContain(">Jeans</span>");
    expect(out).toContain("lucide-trousers");
  });

  test("the image alt tells a screen reader which piece is meant", async () => {
    const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({})]} />);
    expect(out).toContain(
      `alt="${asMarkup("High Rise Straight Jeans. Mila is recommending the jeans")}"`,
    );
  });

  test("the line under the photo leads with the garment", async () => {
    const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({})]} />);
    expect(out).toContain(asMarkup("Jeans: High Rise Straight Jeans"));
  });

  test("the similar-option marker and the category kicker are kept", async () => {
    const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({ source: "similar" })]} />);
    expect(out).toContain(asMarkup("Similar · Bottoms"));
  });

  test("a piece with no photo still names the garment", async () => {
    const out = await renderAppMarkup(
      <ShopThisLookGrid
        items={[pick({ image_url: null, category: "Shoes", title: "Suede Loafers" })]}
      />,
    );
    expect(out).toContain("Image not available");
    expect(out).toContain(">Loafers</span>");
  });

  test("a signed-in member gets a Save button beside the link, never inside it", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(savedProductsQueryKey("user-1"), { status: "ready", items: [] });
    const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({})]} />, {
      userId: "user-1",
      queryClient,
    });
    const anchor = out.slice(out.indexOf("<a "), out.indexOf("</a>") + 4);
    expect(anchor).not.toContain("<button");
    expect(out).toContain(`aria-label="${asMarkup("Save High Rise Straight Jeans")}"`);
  });

  test("a Saved pieces link sits in the section, reachable on a phone", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(savedProductsQueryKey("user-1"), { status: "ready", items: [] });
    const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({})]} />, {
      userId: "user-1",
      queryClient,
    });
    const link = out.match(/<a[^>]*href="\/saved"[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(link).toContain("Saved pieces");
    expect(link).not.toMatch(/(^|\s|")hidden(\s|")/);
    // It comes before the cards, so it is seen without scrolling past every pick.
    expect(out.indexOf('href="/saved"')).toBeLessThan(
      out.indexOf('href="https://shop.example.com/jeans"'),
    );
  });

  test("Save stays hidden while saved pieces are unavailable", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(savedProductsQueryKey("user-1"), { status: "unavailable" });
    const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({})]} />, {
      userId: "user-1",
      queryClient,
    });
    expect(out).not.toContain("<button");
    expect(out).toContain(">Jeans</span>");
  });

  test("no visible copy uses an em-dash or en-dash", async () => {
    const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({})]} />);
    expect(out).not.toMatch(/[–—]/);
  });
});

describe("shop grid colour map", () => {
  const OLIVE = { name: "Olive", hex: "#556B2F", role: "base" } as const;

  /** The markup of the card that links to `href`. */
  function cardFor(out: string, href: string): string {
    const start = out.indexOf(`href="${href}"`);
    return out.slice(start, out.indexOf("</a>", start));
  }

  test("the chip sits beside the garment badge and names the color", async () => {
    const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({ wear_colour: OLIVE })]} />);
    const card = cardFor(out, "https://shop.example.com/jeans");
    expect(card).toContain(">Jeans</span>");
    expect(card).toContain(">Olive</span>");
    expect(card.indexOf(">Olive</span>")).toBeGreaterThan(card.indexOf(">Jeans</span>"));
    expect(card).toMatch(/style="background-color:#556B2F"/);
    // Badge and chip share one bottom-left overlay.
    const overlayStart = card.lastIndexOf("<span", card.indexOf(">Jeans</span>"));
    expect(card.slice(0, overlayStart)).toContain("absolute bottom-2 left-2 flex");
  });

  test("no chip without wear_colour", async () => {
    for (const wear_colour of [undefined, null]) {
      const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({ wear_colour })]} />);
      const card = cardFor(out, "https://shop.example.com/jeans");
      expect(card).toContain(">Jeans</span>");
      // A painted swatch (the Shop button's transition class also names background-color).
      expect(card).not.toContain('style="background-color');
      expect(card).not.toContain("Wear it in");
    }
  });

  test("Save and badge unchanged", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(savedProductsQueryKey("user-1"), { status: "ready", items: [] });
    const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({ wear_colour: OLIVE })]} />, {
      userId: "user-1",
      queryClient,
    });
    const card = cardFor(out, "https://shop.example.com/jeans");
    expect(card).toContain("bg-ink/90");
    expect(card).toContain("lucide-trousers");
    expect(card).not.toContain("<button");
    expect(out).toContain(`aria-label="${asMarkup("Save High Rise Straight Jeans")}"`);
  });

  test("Your color map sits above Shop This Look, and each card is its link target", async () => {
    const out = await renderAppMarkup(
      <ShopThisLookGrid
        items={[
          pick({ wear_colour: OLIVE }),
          pick({
            id: "22222222-2222-4222-8222-222222222222",
            title: "Silk Camp Shirt",
            category: "Tops",
            affiliate_link: "https://shop.example.com/shirt",
            wear_colour: { name: "Cream", hex: "#FFFDD0", role: "statement" },
          }),
        ]}
      />,
    );
    expect(out).toContain("Your color map");
    expect(out.indexOf("Your color map")).toBeLessThan(out.indexOf("Shop This Look"));
    // Head to toe: the shirt's row comes before the jeans' row.
    expect(out.indexOf('href="#shop-22222222-2222-4222-8222-222222222222"')).toBeLessThan(
      out.indexOf('href="#shop-11111111-1111-4111-8111-111111111111"'),
    );
    expect(out).toContain('id="shop-11111111-1111-4111-8111-111111111111"');
    expect(out).toContain('id="shop-22222222-2222-4222-8222-222222222222"');
  });

  test("a look from before colour maps says so honestly", async () => {
    const out = await renderAppMarkup(<ShopThisLookGrid items={[pick({})]} />);
    expect(out).toContain(
      asMarkup("This look has no color map. Looks made after your color read include one."),
    );
    expect(out).not.toContain("See this piece");
  });

  test("no color map when there is nothing to shop", async () => {
    const out = await renderAppMarkup(<ShopThisLookGrid items={[]} />);
    expect(out).toContain("No verified matching item found.");
    expect(out).not.toContain("Your color map");
  });
});
