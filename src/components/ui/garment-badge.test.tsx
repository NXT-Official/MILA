import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GarmentBadge } from "./garment-badge";

describe("GarmentBadge", () => {
  test("shows the garment as visible text beside a decorative icon", () => {
    const out = renderToStaticMarkup(
      <GarmentBadge garment={{ kind: "bottoms", label: "Jeans" }} />,
    );
    expect(out).toContain(">Jeans</span>");
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(out).toContain("lucide-trousers");
  });

  test("is never icon-only: the label is always rendered", () => {
    const out = renderToStaticMarkup(
      <GarmentBadge garment={{ kind: "unknown", label: "Piece" }} />,
    );
    expect(out).toContain(">Piece</span>");
  });

  test("sits bottom-left over the image on a solid ink pill with surface text", () => {
    const out = renderToStaticMarkup(<GarmentBadge garment={{ kind: "top", label: "Top" }} />);
    expect(out).toContain("absolute");
    expect(out).toContain("bottom-2");
    expect(out).toContain("left-2");
    expect(out).toContain("bg-ink/90");
    expect(out).toContain("text-surface");
    expect(out).toContain("rounded-full");
  });

  test("does not catch taps meant for the card underneath", () => {
    const out = renderToStaticMarkup(<GarmentBadge garment={{ kind: "top", label: "Top" }} />);
    expect(out).toContain("pointer-events-none");
  });
});
