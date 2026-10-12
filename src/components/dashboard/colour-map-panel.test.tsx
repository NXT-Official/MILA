import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { pickWeatherBackfill } from "@/lib/look-products.functions";
import { colourMapRows, type ColourMapRow } from "@/lib/wear-colour";
import { ColourMapPanel } from "./colour-map-panel";

/** Copy as it appears in markup: React escapes quotes and ampersands. */
const asMarkup = (copy: string) => renderToStaticMarkup(<>{copy}</>);

const ROWS: ColourMapRow[] = [
  {
    id: "coat-1",
    kind: "outerwear",
    label: "Coat",
    title: "Wool Overcoat",
    wear: { name: "Charcoal", hex: "#36454F", role: "base" },
    reason: "Keeps the line long.",
  },
  {
    id: "top-1",
    kind: "top",
    label: "Shirt",
    title: "Silk Camp Shirt",
    wear: { name: "Cream", hex: "#FFFDD0", role: "statement" },
    reason: "Lifts the face.",
  },
  {
    id: "bag-1",
    kind: "bag",
    label: "Tote",
    title: "Leather Tote",
    wear: { name: "Camel", hex: "#C19A6B", role: "accent" },
    reason: "",
  },
  {
    id: "jeans-1",
    kind: "bottoms",
    label: "Jeans",
    title: "High Rise Straight Jeans",
    wear: null,
    reason: "Balances the volume up top.",
  },
];

const OLD_LOOK_LINE = "This look has no color map. Looks made after your color read include one.";

describe("colour map panel", () => {
  test("one row per planned piece with color name and role words; the old-look line; no dashes", () => {
    const out = renderToStaticMarkup(<ColourMapPanel rows={ROWS} linkToCards />);
    expect(out).toContain("Your color map");
    expect(out).toContain("Wear each piece in one of your colors.");
    expect(out.match(/<li\b/g)).toHaveLength(4);

    expect(out).toContain(">Coat</p>");
    expect(out).toContain(">Charcoal</p>");
    expect(out).toContain(asMarkup("Base · Bottoms and outer layers"));
    expect(out).toContain(">Cream</p>");
    expect(out).toContain(asMarkup("Statement · Near your face"));
    expect(out).toContain(">Camel</p>");
    expect(out).toContain(asMarkup("Accent · Shoes, bag and jewelry"));
    expect(out).toContain("Keeps the line long.");
    expect(out).toContain(asMarkup("No color picked for this piece."));
    expect(out).toContain(
      "Shop links are pieces to wear in these colors. A piece may come in other colorways, so choose the one closest to your color.",
    );
    expect(out).not.toContain(OLD_LOOK_LINE);
    expect(out).not.toMatch(/[–—]/);

    // The order is the rows' order (colourMapRows already runs head to toe).
    expect(out.indexOf(">Coat</p>")).toBeLessThan(out.indexOf(">Shirt</p>"));
    expect(out.indexOf(">Shirt</p>")).toBeLessThan(out.indexOf(">Tote</p>"));

    const old = renderToStaticMarkup(
      <ColourMapPanel rows={ROWS.map((row) => ({ ...row, wear: null }))} linkToCards />,
    );
    expect(old).toContain("Your color map");
    expect(old).toContain(asMarkup(OLD_LOOK_LINE));
    expect(old).not.toContain("<li");
    expect(old).not.toContain("Shop links are pieces");
    expect(old).not.toMatch(/[–—]/);

    expect(renderToStaticMarkup(<ColourMapPanel rows={[]} linkToCards />)).toContain(
      asMarkup(OLD_LOOK_LINE),
    );
  });

  test("each swatch is her hex, decorative, and never the only signal", () => {
    const out = renderToStaticMarkup(<ColourMapPanel rows={ROWS} linkToCards />);
    expect(out).toMatch(/<span aria-hidden="true"[^>]*style="background-color:#36454F"/);
    expect(out).toMatch(/<span aria-hidden="true"[^>]*style="background-color:#FFFDD0"/);
    // A row without a colour paints nothing.
    expect(out.match(/background-color:/g)).toHaveLength(3);
  });

  test("a stored colour that is not a whole, safe color reads as no color", () => {
    const out = renderToStaticMarkup(
      <ColourMapPanel
        rows={[
          { ...ROWS[0], wear: { name: "Charcoal", hex: "url(x)", role: "base" } as never },
          ROWS[1],
        ]}
        linkToCards
      />,
    );
    expect(out).not.toContain("url(x)");
    expect(out).toContain(asMarkup("No color picked for this piece."));
  });

  test("See this piece jumps to its card, a 44px target named for the piece", () => {
    const out = renderToStaticMarkup(<ColourMapPanel rows={ROWS} linkToCards />);
    const link = out.match(/<a [^>]*href="#shop-coat-1"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
    // Visible text "See this piece"; its name starts with that text (label in
    // name) and names the piece. An sr-only span read as "See this piece :
    // Wool Overcoat" in Chrome (found by the e2e run), so the name is set whole.
    expect(link).toMatch(/>See this piece<\/a>$/);
    expect(link).toContain('aria-label="See this piece: Wool Overcoat"');
    expect(link).not.toContain("sr-only");
    expect(link).toContain("min-h-11");
    expect(out.match(/href="#shop-/g)).toHaveLength(4);
  });

  test("without card links (a saved look) there is no jump link", () => {
    const out = renderToStaticMarkup(
      <ColourMapPanel
        rows={ROWS.map(({ kind, label, title, wear }) => ({ kind, label, title, wear }))}
        linkToCards={false}
      />,
    );
    expect(out).not.toContain("See this piece");
    expect(out).not.toContain("href=");
    expect(out.match(/<li\b/g)).toHaveLength(4);
  });

  test("the weather backfill's reason and a model reason with dashes show no dash", () => {
    const backfill = pickWeatherBackfill(
      [{ id: "top-1", category: "Tops" }],
      [
        {
          id: "coat-1",
          title: "Wool Overcoat",
          brand_id: "brand-1",
          category: "Outerwear",
          price: 220,
          currency: "USD",
          image_url: null,
          affiliate_link: "https://shop.example.com/coat-1",
          verification_status: "verified",
          last_verified_at: null,
          description: "A long charcoal wool coat.",
          seasonal_palettes: [],
          body_shapes: [],
          attire: [],
        },
      ],
      { tempF: 40, colorSeason: "Autumn", bodyType: "Hourglass" },
    );
    expect(backfill).not.toBeNull();
    const rows = colourMapRows([
      {
        ...backfill!.product,
        rationale: backfill!.rationale,
        source: "planned",
        wear_colour: { name: "Charcoal", hex: "#36454F", role: "base" },
      },
      {
        id: "top-1",
        title: "Silk Camp Shirt",
        category: "Tops",
        rationale: "Lifts the face — the collar opens it; works from 55–75°F.",
        source: "planned",
        wear_colour: { name: "Cream", hex: "#FFFDD0", role: "statement" },
      },
    ]);
    const out = renderToStaticMarkup(<ColourMapPanel rows={rows} linkToCards />);
    expect(out).toContain(
      asMarkup("Added for today's temperature: the outer layer this look was missing."),
    );
    expect(out).toContain("Lifts the face, the collar opens it; works from 55-75°F.");
    expect(out).not.toMatch(/[‒–—―]/);
  });

  test("the place words show only when the role is where the piece sits", () => {
    const off: ColourMapRow[] = [
      {
        id: "heels-1",
        kind: "shoes",
        label: "Heels",
        title: "Patent Heels",
        wear: { name: "Red", hex: "#C0392B", role: "statement" },
        reason: "",
      },
      {
        id: "top-2",
        kind: "top",
        label: "Top",
        title: "Fitted Top",
        wear: { name: "Navy", hex: "#1F2A44", role: "base" },
        reason: "",
      },
    ];
    const out = renderToStaticMarkup(<ColourMapPanel rows={off} linkToCards />);
    // A statement shoe reads "Heels · Red · Statement", with no place.
    expect(out).toContain(">Heels</p>");
    expect(out).toContain(">Red</p>");
    expect(out).toContain(">Statement</p>");
    expect(out).not.toContain("Near your face");
    expect(out).toContain(">Base</p>");
    expect(out).not.toContain("Bottoms and outer layers");
    expect(out).not.toContain("Shoes, bag and jewelry");
  });

  test("a long unbroken color name wraps instead of widening the row", () => {
    const out = renderToStaticMarkup(
      <ColourMapPanel
        rows={[{ ...ROWS[0], wear: { name: "x".repeat(40), hex: "#36454F", role: "base" } }]}
        linkToCards
      />,
    );
    const name = out.match(/<p class="([^"]*)">x{40}<\/p>/)?.[1] ?? "";
    expect(name).toContain("[overflow-wrap:anywhere]");
  });

  test("the list is named for a screen reader", () => {
    const out = renderToStaticMarkup(<ColourMapPanel rows={ROWS} linkToCards />);
    expect(out).toContain('<ul aria-label="Your color map"');
  });
});
