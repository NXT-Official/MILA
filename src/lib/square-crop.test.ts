import { describe, expect, test } from "bun:test";
import { centeredSquareCrop } from "./square-crop";

describe("centeredSquareCrop", () => {
  test("a 16:9 landscape frame crops to its centred height-by-height square", () => {
    expect(centeredSquareCrop(1280, 720)).toEqual({ sx: 280, sy: 0, size: 720 });
  });

  test("a 9:16 portrait frame crops to its centred width-by-width square", () => {
    expect(centeredSquareCrop(720, 1280)).toEqual({ sx: 0, sy: 280, size: 720 });
  });

  test("an already-square frame is used whole", () => {
    expect(centeredSquareCrop(640, 640)).toEqual({ sx: 0, sy: 0, size: 640 });
  });

  test("an odd leftover rounds the offset down so the source rect stays on whole pixels", () => {
    expect(centeredSquareCrop(641, 480)).toEqual({ sx: 80, sy: 0, size: 480 });
    expect(centeredSquareCrop(480, 641)).toEqual({ sx: 0, sy: 80, size: 480 });
  });

  test("the crop is always square, inside the frame and centred", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [640, 480],
      [480, 640],
      [1, 1000],
    ] as const) {
      const { sx, sy, size } = centeredSquareCrop(w, h);
      expect(size).toBe(Math.min(w, h));
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sx + size).toBeLessThanOrEqual(w);
      expect(sy + size).toBeLessThanOrEqual(h);
      expect(Math.abs(w - sx - size - sx)).toBeLessThanOrEqual(1);
      expect(Math.abs(h - sy - size - sy)).toBeLessThanOrEqual(1);
    }
  });

  test("a frame with no pixels yields an empty crop rather than NaN", () => {
    expect(centeredSquareCrop(0, 720)).toEqual({ sx: 0, sy: 0, size: 0 });
    expect(centeredSquareCrop(1280, 0)).toEqual({ sx: 0, sy: 0, size: 0 });
    expect(centeredSquareCrop(Number.NaN, 720)).toEqual({ sx: 0, sy: 0, size: 0 });
  });
});
