import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { DupeHuntResult, DupeMatch } from "@/lib/dupe-hunter.functions";
import { savedProductsQueryKey } from "@/lib/queries/saved-products";
import { asMarkup, renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { DupeHunterResults } from "./dupe-hunter-results";

function dupe(overrides: Partial<DupeMatch>): DupeMatch {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Satin Evening Clutch",
    brand_id: "b1",
    category: "Accessories",
    price: 45,
    currency: "USD",
    image_url: "https://cdn.example.com/clutch.jpg",
    affiliate_link: "https://shop.example.com/clutch",
    description: null,
    match_score: 0.9,
    match_reasons: ["Same structured silhouette"],
    verification_status: "unverified",
    last_verified_at: null,
    rating: null,
    units_sold: null,
    shipping_info: null,
    discount_percent: null,
    is_verified_seller: false,
    ...overrides,
  };
}

function result(dupes: DupeMatch[]): DupeHuntResult {
  return {
    inspiration: {
      name: "Designer clutch",
      category: "Bags",
      primary_color: "Black",
      color_undertone: "Neutral",
      silhouette_tags: ["structured"],
    },
    dupes,
  };
}

function renderResults(dupes: DupeMatch[]) {
  return renderAppMarkup(
    <DupeHunterResults
      loading={false}
      result={result(dupes)}
      inspirationPreview={null}
      onReset={() => {}}
    />,
  );
}

describe("DupeHunterResults names the piece Mila is recommending", () => {
  test("each dupe carries a garment badge, including the clutch the catalog files as an accessory", async () => {
    const out = await renderResults([dupe({})]);
    expect(out).toContain(">Clutch</span>");
    expect(out).toContain("lucide-handbag");
  });

  test("the image alt and the text line both name the piece", async () => {
    const out = await renderResults([dupe({})]);
    expect(out).toContain(
      `alt="${asMarkup("Satin Evening Clutch. Mila is recommending the clutch")}"`,
    );
    expect(out).toContain(asMarkup("Clutch: Satin Evening Clutch"));
  });

  test("a dupe with no photo still shows its badge", async () => {
    const out = await renderResults([dupe({ image_url: null })]);
    expect(out).toContain("Image not available");
    expect(out).toContain(">Clutch</span>");
  });

  test("a signed-in member can save a dupe; the button sits outside the link", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(savedProductsQueryKey("user-1"), { status: "ready", items: [] });
    const out = await renderAppMarkup(
      <DupeHunterResults
        loading={false}
        result={result([dupe({})])}
        inspirationPreview={null}
        onReset={() => {}}
      />,
      { userId: "user-1", queryClient },
    );
    const anchor = out.slice(out.indexOf("<a "), out.indexOf("</a>") + 4);
    expect(anchor).not.toContain("<button");
    expect(out).toContain(`aria-label="${asMarkup("Save Satin Evening Clutch")}"`);
  });

  test("the existing match reason, freshness line and Shop the Dupe label are kept", async () => {
    const out = await renderResults([dupe({})]);
    expect(out).toContain("Same structured silhouette");
    expect(out).toContain("Link not yet verified");
    expect(out).toContain("Shop the Dupe");
  });
});
