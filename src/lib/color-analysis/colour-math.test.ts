import { describe, expect, test } from "bun:test";
import { chroma, hexToLab, isHex, lightness } from "./colour-math";

// Golden vectors: sRGB (D65) to CIELAB, rounded to 4 decimals. Mobile copies
// these verbatim, so both apps agree on "deepest" and "most vivid".
const GOLDEN: Array<[hex: string, l: number, a: number, b: number, c: number]> = [
  ["#000000", 0, 0, 0, 0],
  ["#FFFFFF", 100, 0, 0, 0],
  ["#808080", 53.585, 0, 0, 0],
  ["#FF0000", 53.2408, 80.0925, 67.2032, 104.5518],
  ["#00FF00", 87.7347, -86.1827, 83.1793, 119.7759],
  ["#0000FF", 32.297, 79.1875, -107.8602, 133.8076],
  ["#C19A6B", 66.1455, 8.367, 30.1537, 31.293],
  ["#36454F", 28.3927, -3.2506, -7.9574, 8.5957],
  ["#800020", 25.8476, 48.8945, 21.2972, 53.3315],
];

describe("colour math", () => {
  test("lightness of #000000 is 0 and #FFFFFF is 100", () => {
    expect(lightness("#000000")).toBe(0);
    expect(lightness("#FFFFFF")).toBe(100);
  });

  test("hexToLab, lightness and chroma match the golden vectors", () => {
    for (const [hex, l, a, b, c] of GOLDEN) {
      expect(hexToLab(hex)).toEqual({ l, a, b });
      expect(lightness(hex)).toBe(l);
      expect(chroma(hex)).toBe(c);
    }
  });

  test("lower case hex reads the same as upper case", () => {
    expect(hexToLab("#c19a6b")).toEqual(hexToLab("#C19A6B"));
  });

  test("never returns negative zero", () => {
    const white = hexToLab("#FFFFFF");
    expect(Object.is(white?.a, -0)).toBe(false);
    expect(Object.is(white?.b, -0)).toBe(false);
  });

  test("an invalid hex reads as null, never NaN", () => {
    for (const bad of ["", "#FFF", "FFFFFF", "#GGGGGG", "#FFFFFFF", "red"]) {
      expect(hexToLab(bad)).toBeNull();
      expect(lightness(bad)).toBeNull();
      expect(chroma(bad)).toBeNull();
    }
  });
});

describe("isHex", () => {
  test("accepts #RRGGBB in either case", () => {
    expect(isHex("#A1b2C3")).toBe(true);
    expect(isHex("#000000")).toBe(true);
  });

  test("refuses everything else", () => {
    for (const value of [
      "#FFF",
      "A1B2C3",
      "#A1B2C",
      "#A1B2C3 ",
      "#A1B2CZ",
      null,
      undefined,
      0xffffff,
    ]) {
      expect(isHex(value)).toBe(false);
    }
  });
});
