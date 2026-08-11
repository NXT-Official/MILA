import { expect, test } from "bun:test";
import { generateDailyPalette } from "./paletteGenerator";

test("consecutive mixes never repeat", () => {
  let prev = generateDailyPalette("cool_summer");
  for (let i = 0; i < 100; i++) {
    const next = generateDailyPalette("cool_summer");
    expect(next.baseHex).not.toBe(prev.baseHex);
    prev = next;
  }
});
