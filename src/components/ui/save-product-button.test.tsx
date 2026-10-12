import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  optimisticSavedProduct,
  savedProductsQueryKey,
  type SaveableProduct,
  type SavedProductsState,
} from "@/lib/queries/saved-products";
import { asMarkup, renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { SaveProductButton } from "./save-product-button";

const USER = "user-1";
const PRODUCT: SaveableProduct = {
  id: "prod-1",
  title: "High Rise Straight Jeans",
  image_url: null,
  affiliate_link: "https://shop.example.com/jeans",
  price: 79,
  currency: "USD",
  category: "Bottoms",
};

function withCache(state: SavedProductsState | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (state) queryClient.setQueryData(savedProductsQueryKey(USER), state);
  return queryClient;
}

function render(state: SavedProductsState | undefined, userId: string | null = USER) {
  return renderAppMarkup(<SaveProductButton product={PRODUCT} context={{ source: "look" }} />, {
    userId,
    queryClient: withCache(state),
  });
}

/** The opening <button ...> tag, or null when no button rendered. */
function buttonTag(markup: string) {
  const match = markup.match(/<button\b[^>]*>/);
  return match ? match[0] : null;
}

describe("SaveProductButton", () => {
  test("offers to save a piece that is not saved yet", async () => {
    const out = await render({ status: "ready", items: [] });
    const tag = buttonTag(out);
    expect(tag).not.toBeNull();
    expect(tag).toContain('aria-pressed="false"');
    expect(tag).toContain(`aria-label="${asMarkup("Save High Rise Straight Jeans")}"`);
    expect(out).toContain("lucide-bookmark");
    expect(out).not.toContain("lucide-bookmark-check");
  });

  test("shows a saved piece as pressed, with a remove label and the check bookmark", async () => {
    const out = await render({
      status: "ready",
      items: [optimisticSavedProduct(PRODUCT, { source: "look" }, "2026-10-07T12:00:00Z")],
    });
    const tag = buttonTag(out);
    expect(tag).toContain('aria-pressed="true"');
    expect(tag).toContain(`aria-label="${asMarkup("Saved, remove High Rise Straight Jeans")}"`);
    expect(out).toContain("lucide-bookmark-check");
  });

  test("is a real button with a 44px touch target and a decorative icon", async () => {
    const tag = buttonTag(await render({ status: "ready", items: [] }));
    expect(tag).toContain('type="button"');
    expect(tag).toContain("size-11");
    const out = await render({ status: "ready", items: [] });
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  test("hides when the feature is not available yet", async () => {
    expect(buttonTag(await render({ status: "unavailable" }))).toBeNull();
  });

  test("hides until the saved list has loaded, so it never shows a wrong state", async () => {
    expect(buttonTag(await render(undefined))).toBeNull();
  });

  test("hides for a signed-out viewer", async () => {
    expect(buttonTag(await render({ status: "ready", items: [] }, null))).toBeNull();
  });
});
