import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MOOD_COLLECT_DEFAULT,
  SEASONS_MASTER_DATA,
  SEASON_HEX_MATRIX,
  type SeasonKey,
} from "@/constants/style-profile";
import { studioToDossier } from "@/lib/style-profile/studio-dossier";
import { avoidSwatchHex, denimShade, mostVivid, toneRole } from "./dossier-display";
import { StudioPortfolioView } from "./studio-portfolio-view";

/** A dossier as a colour read saves it: the sub-season's library entry plus the read's own fields. */
function readFor(key: SeasonKey) {
  return studioToDossier({
    ...SEASONS_MASTER_DATA[key],
    faceShape: "Oval Frame",
    bodyType: "Hourglass",
    stylistNote: "Your coloring, read in daylight.",
    fullPalette: SEASON_HEX_MATRIX[key],
    detectedLighting: "Daylight",
    confidenceScore: 84,
  });
}

function render(key: SeasonKey) {
  const profile = readFor(key);
  return { profile, markup: renderToStaticMarkup(<StudioPortfolioView profile={profile} />) };
}

/** Copy as it appears in the markup: React escapes ampersands and quotes. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

/** Each primary core-tone card as rendered: its hex, its name and the role under it. */
function coreToneCards(markup: string) {
  return [
    ...markup.matchAll(
      /(#[0-9A-F]{6})<\/span><\/div>[\s\S]*?<h4[^>]*>([^<]*)<\/h4>[\s\S]*?<div[^>]*>([^<]*)<\/div>/g,
    ),
  ].map(([, hex, name, role]) => ({ hex, name, role }));
}

/** Section numerals in the order they appear. */
function numerals(markup: string) {
  return [...markup.matchAll(/>(I{1,3}|IV|VI{0,3})(?:<\/span>| · )/g)].map(([, n]) => n);
}

describe("StudioPortfolioView tells one story, drawn from the read", () => {
  const { profile, markup } = render("SPRING_LIGHT");

  test("each core tone's role describes its own swatch", () => {
    const cards = coreToneCards(markup);
    expect(cards.map((c) => c.name)).toEqual(profile.primarySwatches.map((s) => s.name));
    for (const card of cards) expect(card.role).toBe(toneRole(card.hex));
    expect(markup).not.toContain("Midnight Anchor");
  });

  test("a deep palette gets deep roles", () => {
    const winter = coreToneCards(render("WINTER_COOL").markup);
    expect(winter.find((c) => c.name === "Royal Navy")?.role).toBe("Deep Tone");
  });

  test("accent infusions come from the read's palette, not a stock set", () => {
    const winter = render("WINTER_COOL").markup;
    for (const stock of MOOD_COLLECT_DEFAULT.accentSwatches) {
      expect(winter).not.toContain(stock.name);
    }
    for (const accent of mostVivid(SEASONS_MASTER_DATA.WINTER_COOL.secondarySwatches, 2)) {
      expect(winter).toContain(`${accent.name}</h4>`);
    }
  });

  test("accents are the read's boldest secondary colours, so they show on the card", () => {
    expect(markup).toContain("Light Coral Pink</h4>");
    expect(markup).not.toContain("Warm Cream Ivory</h4>");
  });

  test("fabrics are the read's own, each with a feel that fits it", () => {
    expect(markup).toContain(
      `${text("Lightweight Linen")}</h4><span class="text-nano uppercase tracking-label-tight block mt-1 text-stone">${text("Light & Breathable")}`,
    );
    expect(markup).not.toContain(text("Tailored & Dense"));
    expect(markup).not.toContain("Cashmere Blend");
  });

  test("denim swatches match their names, with no stock filler", () => {
    for (const wash of profile.denimRegistry) {
      expect(markup).toContain(`background-color:${denimShade(wash).swatch}`);
      expect(markup).toContain(wash);
    }
    expect(markup).not.toContain("Bone Ecru");
    expect(markup).not.toContain("oklch(0.25 0.05 250)");
  });

  test("avoid swatches show the colour they name", () => {
    const vivid = avoidSwatchHex("Vivid Primary Tones");
    expect(vivid).not.toBeNull();
    expect(markup).toContain(`background-color:${vivid}`);
    expect(markup).not.toContain("#8A6F6F");
  });

  test("section numerals run in order", () => {
    expect(numerals(markup)).toEqual(["I", "II", "III"]);
  });
});
