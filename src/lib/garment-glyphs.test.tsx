import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Gem, Handbag, Shirt, Tag } from "lucide-react";
import { GARMENT_KEYWORDS, GARMENT_KINDS } from "./garment-label";
import { GemRing, HighHeel, Trousers, garmentGlyph } from "./garment-glyphs";

describe("garmentGlyph", () => {
  test("every kind has a glyph", () => {
    for (const kind of GARMENT_KINDS) {
      expect(garmentGlyph({ kind, label: "anything" })).toBeDefined();
    }
  });

  test("every keyword label resolves to a glyph", () => {
    for (const entry of GARMENT_KEYWORDS) {
      const kind = entry.kind ?? entry.within[0];
      expect(garmentGlyph({ kind, label: entry.label })).toBeDefined();
    }
  });

  test("labels that look different from their kind get their own glyph", () => {
    expect(garmentGlyph({ kind: "shoes", label: "Heels" })).toBe(HighHeel);
    expect(garmentGlyph({ kind: "jewelry", label: "Ring" })).toBe(GemRing);
    expect(garmentGlyph({ kind: "bottoms", label: "Jeans" })).toBe(Trousers);
  });

  test("a charm, a label from real catalog names, gets the gem glyph", () => {
    expect(garmentGlyph({ kind: "accessory", label: "Charm" })).toBe(Gem);
  });

  test("lucide's own icons are reused where they exist", () => {
    expect(garmentGlyph({ kind: "top", label: "Shirt" })).toBe(Shirt);
    expect(garmentGlyph({ kind: "bag", label: "Clutch" })).toBe(Handbag);
    expect(garmentGlyph({ kind: "unknown", label: "Swimwear" })).toBe(Tag);
  });

  test("a copied lab glyph renders as a decorative lucide svg", () => {
    const markup = renderToStaticMarkup(<Trousers className="size-3" />);
    expect(markup).toStartWith("<svg");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("lucide-trousers");
    expect(markup).toContain('d="M4 6h16"');
  });
});
