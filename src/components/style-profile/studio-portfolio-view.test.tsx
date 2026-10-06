import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MOOD_COLLECT_DEFAULT,
  SEASONS_MASTER_DATA,
  SEASON_HEX_MATRIX,
  type DetailedColorProfile,
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

function render(key: SeasonKey, change: Partial<DetailedColorProfile> = {}) {
  const profile = { ...readFor(key), ...change };
  return { profile, markup: renderToStaticMarkup(<StudioPortfolioView profile={profile} />) };
}

/** Copy as it appears in the markup: React escapes ampersands and quotes. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

/** Each primary core-tone card as rendered: its hex, its name and the role under it (if any). */
function coreToneCards(markup: string) {
  return [
    ...markup.matchAll(
      /(#[0-9A-F]{6})<\/span><\/div><div[^>]*><div[^>]*><h4[^>]*>([^<]*)<\/h4><\/div>(?:<div[^>]*>([^<]*)<\/div>)?<\/div>/g,
    ),
  ].map(([, hex, name, role]): { hex: string; name: string; role: string | null } => ({
    hex,
    name,
    role: role ?? null,
  }));
}

/** Each accent card as rendered: its name and the label above it (if any). */
function accentCards(markup: string) {
  const section = markup.split("Seasonal Accent Infusions")[1]?.split("Tone Type")[0] ?? "";
  return [
    ...section.matchAll(
      /<div class="w-2\/3[^"]*"><div>(?:<span[^>]*>([^<]*)<\/span>)?<h4[^>]*>([^<]*)<\/h4>/g,
    ),
  ].map(([, label, name]): { name: string; label: string | null } => ({
    name,
    label: label ?? null,
  }));
}

/** Each textile card's class list, in order. */
function textileCards(markup: string) {
  const section = markup.split("Textile Drape")[1]?.split("The Denim Archive")[0] ?? "";
  return [...section.matchAll(/<div class="(relative p-5 [^"]*)"/g)].map(([, cls]) => cls);
}

/** Section numerals in the order they appear. */
function numerals(markup: string) {
  return [...markup.matchAll(/>(I{1,3}|IV|VI{0,3})(?:<\/span>| · )/g)].map(([, n]) => n);
}

describe("StudioPortfolioView tells one story, drawn from the read", () => {
  const { profile, markup } = render("SPRING_LIGHT");

  test("each core tone's role describes its own swatch", () => {
    const { profile: autumn, markup: autumnMarkup } = render("AUTUMN_TRUE");
    const cards = coreToneCards(autumnMarkup);
    expect(cards.map((c) => c.name)).toEqual(autumn.primarySwatches.map((s) => s.name));
    for (const card of cards) expect(card.role).toBe(toneRole(card.hex));
    expect(cards.find((c) => c.name === "Forest Olive")?.role).toBe("Deep Tone");
    expect(markup).not.toContain("Midnight Anchor");
  });

  test("an all-light palette gets one caption, not four identical labels", () => {
    const cards = coreToneCards(markup);
    expect(cards.map((c) => c.name)).toEqual(profile.primarySwatches.map((s) => s.name));
    expect(cards.map((c) => c.role)).toEqual([null, null, null, null]);
    expect(markup.split(">All light tones<").length - 1).toBe(1);
  });

  test("an all-deep palette gets one caption, not four identical labels", () => {
    const winter = render("WINTER_DEEP").markup;
    expect(coreToneCards(winter).map((c) => c.role)).toEqual([null, null, null, null]);
    expect(winter.split(">All deep tones<").length - 1).toBe(1);
  });

  test("accent labels never go by position", () => {
    for (const key of ["WINTER_TRUE", "AUTUMN_DEEP", "SPRING_LIGHT"] as const) {
      const cards = accentCards(render(key).markup);
      expect(cards.map((c) => c.name)).toEqual(
        mostVivid(SEASONS_MASTER_DATA[key].secondarySwatches, 2).map((s) => s.name),
      );
      expect(cards.map((c) => c.label)).toEqual([null, null]);
    }
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

  test("three textile cards don't leave an orphan on a phone", () => {
    const cards = textileCards(markup);
    expect(cards).toHaveLength(3);
    expect(cards[2]).toContain("col-span-2 md:col-span-1");
    expect(cards[0]).not.toContain("col-span-2");
  });

  test("denim swatches match their names, with no stock filler", () => {
    for (const wash of profile.denimRegistry) {
      expect(markup).toContain(`background-color:${denimShade(wash)?.swatch}`);
      expect(markup).toContain(wash);
    }
    expect(markup).not.toContain("Bone Ecru");
    expect(markup).not.toContain("oklch(0.25 0.05 250)");
  });

  test("a denim it doesn't know shows its name with no guessed swatch", () => {
    const odd = render("SPRING_LIGHT", { denimRegistry: ["Straw Selvage Twill"] }).markup;
    const section = odd.split("The Denim Archive")[1]?.split("Colors to Avoid")[0] ?? "";
    expect(section).toContain("Straw Selvage Twill");
    expect(section).not.toContain("background-color");
    expect(section).not.toContain("wash<");
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
