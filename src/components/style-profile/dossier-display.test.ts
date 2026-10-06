import { describe, expect, test } from "bun:test";
import {
  MOOD_COLLECT_DEFAULT,
  SEASONS_MASTER_DATA,
  SEASON_DETAIL,
} from "@/constants/style-profile";
import {
  avoidSwatchHex,
  denimShade,
  fabricFeel,
  mostVivid,
  swatchLightness,
  toneRole,
} from "./dossier-display";

const SPECS = Object.values(SEASONS_MASTER_DATA);

/** The name half of an avoid line — what the dossier prints on the swatch card. */
function avoidName(line: string) {
  return line.split(/[—(]/)[0].trim();
}

function channels(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

describe("swatchLightness", () => {
  test("reads black as 0 and white as 100", () => {
    expect(swatchLightness("#000000")).toBe(0);
    expect(swatchLightness("#FFFFFF")).toBeCloseTo(100, 5);
  });

  test("returns null for anything that isn't a 6-digit hex", () => {
    expect(swatchLightness("navy")).toBeNull();
    expect(swatchLightness("#FFF")).toBeNull();
  });
});

describe("toneRole — the label under a core tone comes from the swatch itself", () => {
  test("a pale mint is never called a dark anchor", () => {
    expect(toneRole("#D4EDDA")).toBe("Light Tone");
  });

  test("a navy reads as deep and a coral as mid", () => {
    expect(toneRole("#1F3A52")).toBe("Deep Tone");
    expect(toneRole("#FF7F50")).toBe("Mid Tone");
  });

  test("a value it can't read gets a neutral label", () => {
    expect(toneRole("not-a-colour")).toBe("Signature Tone");
  });
});

describe("mostVivid — accents are the boldest colours in her own palette", () => {
  test("picks the two most colourful swatches, in palette order on a tie", () => {
    const picks = mostVivid(SEASONS_MASTER_DATA.SPRING_LIGHT.secondarySwatches, 2);
    expect(picks.map((s) => s.name)).toEqual(["Light Coral Pink", "Soft Aquamarine"]);
  });

  test("only ever returns swatches it was given", () => {
    const palette = SEASONS_MASTER_DATA.WINTER_COOL.secondarySwatches;
    for (const pick of mostVivid(palette, 2)) expect(palette).toContainEqual(pick);
  });

  test("returns what there is when the palette is short", () => {
    expect(mostVivid([{ hex: "#123456", name: "Only" }], 2)).toEqual([
      { hex: "#123456", name: "Only" },
    ]);
  });
});

describe("fabricFeel — the drape line matches the fabric it sits under", () => {
  test("linen reads light, never tailored and dense", () => {
    expect(fabricFeel("Lightweight Linen")).toBe("Light & Breathable");
  });

  test("sheer fabrics read sheer, wools read tailored", () => {
    expect(fabricFeel("Chiffon & Organza")).toBe("Sheer & Airy");
    expect(fabricFeel("Structured Wool Tweed")).toBe("Tailored & Dense");
  });

  test("every fabric in the season library gets a feel", () => {
    for (const material of SPECS.flatMap((s) => s.fabrication)) {
      expect({ material, feel: fabricFeel(material) }).toEqual({
        material,
        feel: expect.any(String),
      });
    }
  });

  test("an unknown fabric gets no feel rather than a guessed one", () => {
    expect(fabricFeel("Moon Fibre")).toBeNull();
  });
});

describe("denimShade — the swatch is the wash it is named for", () => {
  test("a bleached blue is light, not dark navy", () => {
    expect(swatchLightness(denimShade("Soft Bleached Blue Denim").swatch)).toBeGreaterThan(70);
  });

  test("a light gray is light and gray, not mid blue", () => {
    const { swatch } = denimShade("Pure Light Gray Denim");
    const { r, b } = channels(swatch);
    expect(swatchLightness(swatch)).toBeGreaterThan(70);
    expect(Math.abs(r - b)).toBeLessThan(16);
  });

  test("raw and inky washes are dark", () => {
    expect(swatchLightness(denimShade("Dark Indigo Raw Denim").swatch)).toBeLessThan(30);
    expect(swatchLightness(denimShade("Crisp Inky Black Denim").swatch)).toBeLessThan(30);
  });

  test("white denim is white and brown washes are warm", () => {
    expect(swatchLightness(denimShade("Crisp White Denim").swatch)).toBeGreaterThan(90);
    const { r, b } = channels(denimShade("Espresso Brown Denim").swatch);
    expect(r).toBeGreaterThan(b);
  });

  test("every denim in the season library gets a finish line", () => {
    for (const wash of [
      ...SPECS.flatMap((s) => s.denimRegistry),
      ...MOOD_COLLECT_DEFAULT.denimRegistry,
    ]) {
      expect(denimShade(wash).finish.length).toBeGreaterThan(0);
    }
  });
});

describe("avoidSwatchHex — the avoid swatch shows the colour it names", () => {
  test("vivid primaries are a vivid red, not dusty mauve", () => {
    const hex = avoidSwatchHex("Vivid Primary Tones");
    expect(hex).not.toBe("#8A6F6F");
    const { r, g, b } = channels(hex ?? "#000000");
    expect(r).toBeGreaterThan(180);
    expect(Math.max(g, b)).toBeLessThan(90);
  });

  test("icy blue is blue and burnt orange is orange", () => {
    const blue = channels(avoidSwatchHex("Icy Cool Blue") ?? "#000000");
    expect(blue.b).toBeGreaterThan(blue.r);
    const orange = channels(avoidSwatchHex("Burnt Orange") ?? "#000000");
    expect(orange.r).toBeGreaterThan(orange.g);
    expect(orange.g).toBeGreaterThan(orange.b);
  });

  test("a pastel orange is lighter than a burnt one", () => {
    const pastel = swatchLightness(avoidSwatchHex("Soft Pastel Orange") ?? "");
    const burnt = swatchLightness(avoidSwatchHex("Burnt Orange") ?? "");
    expect(pastel ?? 0).toBeGreaterThan(burnt ?? 100);
  });

  test("every avoid colour in the season library gets a swatch", () => {
    const lines = [
      ...SPECS.flatMap((s) => s.avoidColors),
      ...MOOD_COLLECT_DEFAULT.avoidColors,
      ...Object.values(SEASON_DETAIL).flatMap((d) => d.avoid),
    ];
    for (const name of lines.map(avoidName)) {
      expect({ name, hex: avoidSwatchHex(name) }).toEqual({ name, hex: expect.any(String) });
    }
  });

  test("a colour it doesn't know gets no swatch rather than a wrong one", () => {
    expect(avoidSwatchHex("Something Unheard Of")).toBeNull();
  });
});
