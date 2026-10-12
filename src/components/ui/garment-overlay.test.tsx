import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GarmentOverlay } from "./garment-overlay";

const JEANS = { kind: "bottoms", label: "Jeans" } as const;
const OLIVE = { name: "Olive", hex: "#556B2F", role: "base" } as const;

/** The opening tag of the first element whose class list contains `marker`. */
function tagWith(out: string, marker: string): string {
  return out.match(new RegExp(`<[a-z]+ [^>]*class="[^"]*${marker}[^"]*"[^>]*>`))?.[0] ?? "";
}

describe("GarmentOverlay", () => {
  test("holds the garment badge, then the color chip, bottom-left over the image", () => {
    const out = renderToStaticMarkup(<GarmentOverlay garment={JEANS} wear={OLIVE} />);
    const container = out.slice(0, out.indexOf(">") + 1);
    expect(container).toContain("absolute");
    expect(container).toContain("bottom-2");
    expect(container).toContain("left-2");
    expect(container).toContain("flex");
    expect(out.indexOf(">Jeans</span>")).toBeGreaterThan(-1);
    expect(out.indexOf(">Olive</span>")).toBeGreaterThan(out.indexOf(">Jeans</span>"));
  });

  test("the badge flows inside the overlay instead of floating on its own", () => {
    const out = renderToStaticMarkup(<GarmentOverlay garment={JEANS} wear={OLIVE} />);
    const badge = tagWith(out, "bg-ink/90 px-2");
    expect(badge).toContain("static");
    expect(badge).not.toMatch(/(^|[\s"])absolute([\s"]|$)/);
  });

  test("no chip without a color", () => {
    for (const wear of [null, undefined]) {
      const out = renderToStaticMarkup(<GarmentOverlay garment={JEANS} wear={wear} />);
      expect(out).toContain(">Jeans</span>");
      expect(out).not.toContain("Wear it in");
      expect(out).not.toContain("background-color");
    }
  });

  test("does not catch taps meant for the card underneath", () => {
    const out = renderToStaticMarkup(<GarmentOverlay garment={JEANS} wear={OLIVE} />);
    expect(out.slice(0, out.indexOf(">") + 1)).toContain("pointer-events-none");
  });
});
