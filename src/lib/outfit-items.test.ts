import { describe, expect, it } from "bun:test";
import {
  MAX_DETECTED_ITEMS,
  normalizeSourceUrl,
  parseDetectedItems,
  sourceUrlHost,
} from "./outfit-items";

const TANK = {
  name: "Ribbed white tank",
  category: "Tops",
  primary_color: "White",
  color_undertone: "Neutral",
  silhouette_tags: ["cropped", "scoop-neck"],
  bbox: { x: 0.3, y: 0.15, w: 0.4, h: 0.25 },
};

describe("parseDetectedItems", () => {
  it("keeps a well-formed garment as-is", () => {
    const [item] = parseDetectedItems([TANK]);
    expect(item.label).toBe("Ribbed white tank");
    expect(item.bbox).toEqual({ x: 0.3, y: 0.15, w: 0.4, h: 0.25 });
    expect(item.attributes.silhouette_tags).toEqual(["cropped", "scoop-neck"]);
  });

  it("drops only the malformed garments, never the whole outfit", () => {
    const items = parseDetectedItems([
      { ...TANK, category: "Hats" }, // not a known category
      { ...TANK, bbox: { x: 0.1, y: 0.1 } }, // half a box
      { ...TANK, name: "   " }, // nothing to label the hotspot with
      { ...TANK, bbox: { x: 0.4, y: 0.4, w: 0, h: 0.2 } }, // untappable
      TANK,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("Ribbed white tank");
  });

  it("rescales boxes the model normalized to its own units", () => {
    const [thousand] = parseDetectedItems([{ ...TANK, bbox: { x: 300, y: 150, w: 400, h: 250 } }]);
    expect(thousand.bbox).toEqual({ x: 0.3, y: 0.15, w: 0.4, h: 0.25 });

    const [percent] = parseDetectedItems([{ ...TANK, bbox: { x: 30, y: 15, w: 40, h: 25 } }]);
    expect(percent.bbox).toEqual({ x: 0.3, y: 0.15, w: 0.4, h: 0.25 });
  });

  it("clips a box that runs off the photo instead of positioning a hotspot outside it", () => {
    const [item] = parseDetectedItems([{ ...TANK, bbox: { x: -0.2, y: 0.8, w: 0.5, h: 0.6 } }]);
    expect(item.bbox).toEqual({ x: 0, y: 0.8, w: 0.3, h: 0.2 });
  });

  it("bounds a runaway response and ignores non-arrays", () => {
    expect(parseDetectedItems(Array(20).fill(TANK))).toHaveLength(MAX_DETECTED_ITEMS);
    expect(parseDetectedItems({ items: [TANK] })).toEqual([]);
    expect(parseDetectedItems(null)).toEqual([]);
  });
});

describe("poster-supplied source links", () => {
  it("accepts https and rejects everything else", () => {
    expect(normalizeSourceUrl(" https://shop.example.com/tank ")).toBe(
      "https://shop.example.com/tank",
    );
    expect(normalizeSourceUrl("http://shop.example.com")).toBeNull();
    expect(normalizeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeSourceUrl("data:text/html,<script>")).toBeNull();
    expect(normalizeSourceUrl("shop.example.com")).toBeNull();
    expect(normalizeSourceUrl("")).toBeNull();
  });

  it("shows the real host, so a link cannot dress up as another domain", () => {
    expect(sourceUrlHost("https://www.zara.com/x?utm=zara.com")).toBe("zara.com");
    expect(sourceUrlHost("https://evil.example.com/zara.com/tank")).toBe("evil.example.com");
  });
});
