import { describe, expect, test } from "bun:test";
import {
  optimisticSavedProduct,
  type SavedProduct,
  type SavedProductsState,
} from "@/lib/queries/saved-products";
import { asMarkup, renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { SavedPiecesView } from "./saved-pieces-view";

function saved(overrides: Partial<SavedProduct> & { title?: string; category?: string }) {
  const { title = "High Rise Straight Jeans", category = "Bottoms", ...rest } = overrides;
  const item: SavedProduct = {
    id: `row-${title}`,
    product_id: `prod-${title}`,
    source: "look",
    outfit_id: null,
    post_item_id: null,
    created_at: "2026-10-01T10:00:00Z",
    snapshot: {
      title,
      image_url: "https://cdn.example.com/p.jpg",
      product_url: "https://shop.example.com/snapshot",
      price: 79,
      currency: "USD",
      category,
      brand: "Example Denim",
    },
    live: {
      in_stock: true,
      verification_status: "verified",
      affiliate_link: `https://shop.example.com/live/${encodeURIComponent(title)}`,
    },
    ...rest,
  };
  return item;
}

function render(props: Partial<Parameters<typeof SavedPiecesView>[0]>) {
  return renderAppMarkup(
    <SavedPiecesView
      state={undefined}
      isLoading={false}
      isError={false}
      onRetry={() => {}}
      onRemove={async () => {}}
      {...props}
    />,
    { userId: "user-1" },
  );
}

const ready = (items: SavedProduct[]): SavedProductsState => ({ status: "ready", items });

/** The markup of the card whose text contains `title`. */
function card(markup: string, title: string) {
  const cards = markup.split('data-saved-piece=""').slice(1);
  const found = cards.find((c) => c.includes(asMarkup(title)));
  expect(found).toBeDefined();
  return found as string;
}

describe("SavedPiecesView states", () => {
  test("loading shows a skeleton announced as a status", async () => {
    const out = await render({ isLoading: true });
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-label="Loading saved pieces"');
  });

  test("an error offers a retry", async () => {
    const out = await render({ isError: true });
    expect(out).toContain('role="alert"');
    expect(out).toContain(asMarkup("Couldn't load your saved pieces"));
    expect(out).toContain("Try Again");
  });

  test("an unavailable feature is explained calmly, not as an error", async () => {
    const out = await render({ state: { status: "unavailable" } });
    expect(out).not.toContain('role="alert"');
    expect(out).toContain("Saved pieces are almost ready");
  });

  test("an empty list says how to fill it", async () => {
    const out = await render({ state: ready([]) });
    expect(out).toContain(
      asMarkup("Tap the bookmark on any piece Mila recommends and it will wait here."),
    );
  });
});

describe("SavedPiecesView list", () => {
  const items = [
    saved({ title: "Leather Ankle Boots", category: "Shoes" }),
    saved({ title: "High Rise Straight Jeans", category: "Bottoms" }),
    saved({ title: "Oxford Shirt", category: "Tops" }),
  ];

  test("groups by garment, head to toe", async () => {
    const out = await render({ state: ready(items) });
    const tops = out.indexOf(">Tops</h2>");
    const bottoms = out.indexOf(">Bottoms</h2>");
    const shoes = out.indexOf(">Shoes</h2>");
    expect(tops).toBeGreaterThan(-1);
    expect(tops).toBeLessThan(bottoms);
    expect(bottoms).toBeLessThan(shoes);
  });

  test("each piece carries its badge and the label line", async () => {
    const out = await render({ state: ready(items) });
    const jeans = card(out, "High Rise Straight Jeans");
    expect(jeans).toContain(">Jeans</span>");
    expect(jeans).toContain(asMarkup("Jeans: High Rise Straight Jeans"));
  });

  test("an available piece links to the live shop link in a new tab", async () => {
    const out = await render({ state: ready(items) });
    const jeans = card(out, "High Rise Straight Jeans");
    expect(jeans).toContain(
      `href="${asMarkup("https://shop.example.com/live/High%20Rise%20Straight%20Jeans")}"`,
    );
    expect(jeans).toContain('target="_blank"');
    expect(jeans).toContain(">Shop<");
  });

  test("every piece can be removed", async () => {
    const out = await render({ state: ready(items) });
    expect(card(out, "Oxford Shirt")).toContain(`aria-label="${asMarkup("Remove Oxford Shirt")}"`);
  });

  test("a deleted product shows its snapshot, says it is gone and offers no Shop link", async () => {
    const out = await render({
      state: ready([
        saved({ title: "Doomed Coat", category: "Outerwear", product_id: null, live: null }),
      ]),
    });
    const coat = card(out, "Doomed Coat");
    expect(coat).toContain("No longer available");
    expect(coat).not.toContain("<a ");
    expect(coat).toContain(">Coat</span>");
    expect(coat).toContain(asMarkup("Remove Doomed Coat"));
  });

  test("out of stock and broken links are labelled and offer no Shop link", async () => {
    const out = await render({
      state: ready([
        saved({
          title: "Silk Neck Scarf",
          category: "Accessories",
          live: {
            in_stock: false,
            verification_status: "verified",
            affiliate_link: "https://x.example.com",
          },
        }),
        saved({
          title: "Gold Hoop Earrings",
          category: "Jewelry",
          live: {
            in_stock: true,
            verification_status: "broken",
            affiliate_link: "https://y.example.com",
          },
        }),
      ]),
    });
    const scarf = card(out, "Silk Neck Scarf");
    expect(scarf).toContain("Out of stock");
    expect(scarf).not.toContain("<a ");
    const hoops = card(out, "Gold Hoop Earrings");
    expect(hoops).toContain("Link unavailable");
    expect(hoops).not.toContain("<a ");
  });

  test("a piece saved a moment ago shows its Shop link right away, not 'No longer available'", async () => {
    const justSaved = optimisticSavedProduct(
      {
        id: "prod-new",
        title: "Oxford Shirt",
        image_url: null,
        affiliate_link: "https://shop.example.com/oxford",
        price: 59,
        currency: "USD",
        category: "Tops",
        verification_status: "verified",
      },
      { source: "look" },
      "2026-10-07T11:00:00Z",
    );
    const out = await render({ state: ready([justSaved]) });
    const shirt = card(out, "Oxford Shirt");
    expect(shirt).not.toContain("No longer available");
    expect(shirt).toContain('href="https://shop.example.com/oxford"');
  });

  test("no visible copy uses an em-dash or en-dash", async () => {
    for (const state of [ready(items), ready([]), { status: "unavailable" } as const]) {
      expect(await render({ state })).not.toMatch(/[–—]/);
    }
  });
});
