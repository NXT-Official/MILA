import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConciergeContent, DailyPaletteContent } from "@/lib/landing-content";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { normalizeLandingContent } from "@/lib/landing-content.normalize";
import { STYLE_FLOW_SHOP, STYLE_FLOW_STEPS } from "./style-flow-copy";
import { StyleFlowStack } from "./style-flow-stack";

const TARGET = { projectId: "8bkzi9bn", dataset: "production" };
const CDN = "https://cdn.sanity.io/images/8bkzi9bn/production/abc-800x600.jpg";

/** Copy as it appears in the markup: React escapes quotes, ampersands and angle brackets. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

function count(markup: string, needle: string) {
  return markup.split(needle).length - 1;
}

function render(
  palette: DailyPaletteContent = LANDING_FALLBACK.dailyPalette,
  concierge: ConciergeContent = LANDING_FALLBACK.concierge,
) {
  return renderToStaticMarkup(<StyleFlowStack palette={palette} concierge={concierge} />);
}

const HIDDEN_PALETTE: DailyPaletteContent = {
  hidden: true,
  heading: "",
  body: "",
  image: { src: "", alt: "" },
  swatches: [],
};
const HIDDEN_CONCIERGE: ConciergeContent = {
  hidden: true,
  heading: "",
  body: "",
  image: { src: "", alt: "" },
  exchange: [],
};

describe("StyleFlowStack on the server (no motion has run)", () => {
  test("one section: read your colors, compose the look, shop it", () => {
    const out = render();
    expect(count(out, "<section")).toBe(1);
    expect(out).toContain(">Read your colors, compose the look, shop it.</h2>");
    expect(count(out, "data-stack-panel")).toBe(3);
    for (const step of Object.values(STYLE_FLOW_STEPS)) expect(out).toContain(`>${step.title}<`);
  });

  test("every piece of the palette section is in the first panel", () => {
    const out = render();
    const palette = LANDING_FALLBACK.dailyPalette;
    expect(out).toContain(`>${text(palette.heading)}</h3>`);
    expect(out).toContain(`>${text(palette.body)}<`);
    expect(out).toContain(`src="${text(palette.image.src)}"`);
    expect(out).toContain(`alt="${text(palette.image.alt)}"`);
    for (const swatch of palette.swatches) {
      expect(out).toContain(`>${text(swatch.label)}<`);
      expect(out).toContain(`background-color:${swatch.hex}`);
    }
  });

  test("every piece of the concierge section is in the compose and shop panels", () => {
    const out = render();
    const concierge = LANDING_FALLBACK.concierge;
    expect(out).toContain(`>${text(concierge.heading)}</h3>`);
    expect(out).toContain(`>${text(concierge.body)}<`);
    for (const message of concierge.exchange) expect(out).toContain(`>${text(message.text)}<`);
    expect(out).toContain(`src="${text(concierge.image.src)}"`);
    expect(out).toContain(`alt="${text(concierge.image.alt)}"`);
    expect(out).toContain(`>${text(STYLE_FLOW_SHOP.heading)}</h3>`);
    expect(out).toContain(`>${text(STYLE_FLOW_SHOP.body)}<`);
  });

  test("the panels read in the order she uses Mila", () => {
    const out = render();
    const at = (copy: string) => out.indexOf(`>${text(copy)}</h3>`);
    expect(at(LANDING_FALLBACK.dailyPalette.heading)).toBeGreaterThan(-1);
    expect(at(LANDING_FALLBACK.dailyPalette.heading)).toBeLessThan(
      at(LANDING_FALLBACK.concierge.heading),
    );
    expect(at(LANDING_FALLBACK.concierge.heading)).toBeLessThan(at(STYLE_FLOW_SHOP.heading));
  });

  test("the panels are plain stacked blocks: nothing pinned, moved or hidden", () => {
    const out = render();
    // The only inline style is a swatch colour.
    const styles = [...out.matchAll(/ style="([^"]*)"/g)].map(([, style]) => style);
    expect(styles.filter((style) => !/^background-color:#[0-9A-Fa-f]{6}$/.test(style))).toEqual([]);
    expect(out).not.toContain("data-stack-motion");
    expect(out).not.toMatch(/opacity|transform|position:\s*fixed/);
  });
});

describe("StyleFlowStack while pinned", () => {
  // Pinned panels overlap. Only the cards may be opaque: an opaque panel is a
  // full block of canvas that wipes the card pinned under it before the next
  // card arrives (LANDING review C1).
  test("a panel has no background of its own, pinned or not; its card does", () => {
    const out = render();
    const panels = [...out.matchAll(/<article\b[^>]*class="([^"]*)"/g)].map(([, cls]) => cls);
    expect(panels).toHaveLength(3);
    for (const cls of panels) expect(cls).not.toMatch(/(^|\s|:)bg-/);
    const cards = [...out.matchAll(/<div\b[^>]*data-stack-card=""[^>]*class="([^"]*)"/g)];
    expect(cards).toHaveLength(3);
    for (const [, cls] of cards) expect(cls).toMatch(/(^|\s)bg-card(\s|$)/);
  });
});

describe("StyleFlowStack follows the Studio's visibility flags", () => {
  test("a hidden palette leaves compose and shop", () => {
    const out = render(HIDDEN_PALETTE);
    expect(count(out, "data-stack-panel")).toBe(2);
    expect(out).toContain(">Compose the look, shop it.</h2>");
    expect(out).not.toContain(`>${STYLE_FLOW_STEPS.palette.title}<`);
  });

  test("a hidden concierge leaves the palette alone", () => {
    const out = render(LANDING_FALLBACK.dailyPalette, HIDDEN_CONCIERGE);
    expect(count(out, "data-stack-panel")).toBe(1);
    expect(out).toContain(">Read your colors.</h2>");
    expect(out).not.toContain(text(STYLE_FLOW_SHOP.heading));
  });

  test("with both hidden nothing renders", () => {
    expect(render(HIDDEN_PALETTE, HIDDEN_CONCIERGE)).toBe("");
  });
});

describe("StyleFlowStack renders Studio content", () => {
  test("CMS swatches and image replace the built-in ones", () => {
    const palette = normalizeLandingContent(
      {
        dailyPalette: {
          heading: "Today's mix",
          image: { url: CDN, alt: "A flat-lay in sage" },
          swatches: [{ _key: "a", label: "Sage", hex: "#9caf88" }],
        },
      },
      TARGET,
    ).dailyPalette;
    const out = render(palette);
    expect(out).toContain("Today&#x27;s mix");
    expect(out).toContain(`src="${CDN}?auto=format&amp;fit=max&amp;w=960"`);
    expect(out).toContain('alt="A flat-lay in sage"');
    expect(out).toContain("background-color:#9CAF88");
    expect(out).not.toContain("Base Layer");
  });

  test("HTML-looking CMS text is escaped, never injected", () => {
    const concierge = normalizeLandingContent(
      {
        concierge: {
          heading: "<script>alert(1)</script>",
          exchange: [{ _key: "q", role: "user", text: "<b>x</b>" }],
        },
      },
      TARGET,
    ).concierge;
    const out = render(LANDING_FALLBACK.dailyPalette, concierge);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
