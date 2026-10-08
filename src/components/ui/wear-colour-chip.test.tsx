import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WearColourChip } from "./wear-colour-chip";

const OLIVE = { name: "Olive", hex: "#556B2F", role: "base" } as const;

describe("WearColourChip", () => {
  test("names the color as visible text beside a decorative swatch dot", () => {
    const out = renderToStaticMarkup(<WearColourChip wear={OLIVE} />);
    expect(out).toContain(">Olive</span>");
    expect(out).toMatch(/<span aria-hidden="true"[^>]*style="background-color:#556B2F"/);
  });

  test("is an ink pill with surface text, and the dot has a surface ring", () => {
    const out = renderToStaticMarkup(<WearColourChip wear={OLIVE} />);
    expect(out).toContain("bg-ink/90");
    expect(out).toContain("text-surface");
    expect(out).toContain("rounded-full");
    expect(out).toContain("ring-surface");
  });

  test("tells a screen reader what the color is for", () => {
    const out = renderToStaticMarkup(<WearColourChip wear={OLIVE} />);
    expect(out).toContain('<span class="sr-only">Wear it in </span>');
  });

  test("does not catch taps meant for the card underneath", () => {
    const out = renderToStaticMarkup(<WearColourChip wear={OLIVE} />);
    expect(out).toContain("pointer-events-none");
  });

  test("renders nothing without a whole, safe color", () => {
    expect(renderToStaticMarkup(<WearColourChip wear={null} />)).toBe("");
    expect(renderToStaticMarkup(<WearColourChip wear={undefined} />)).toBe("");
    expect(
      renderToStaticMarkup(
        <WearColourChip wear={{ name: "Olive", hex: "url(x)", role: "base" } as never} />,
      ),
    ).toBe("");
  });

  test("no visible copy uses an em-dash or en-dash", () => {
    expect(renderToStaticMarkup(<WearColourChip wear={OLIVE} />)).not.toMatch(/[–—]/);
  });
});
