import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DossierContent, DossierRow } from "@/lib/landing-content";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";
import { normalizeLandingContent } from "@/lib/landing-content.normalize";
import { DossierSection } from "./dossier-section";

const TARGET = { projectId: "8bkzi9bn", dataset: "production" };
const CDN = "https://cdn.sanity.io/images/8bkzi9bn/production/abc-800x600.jpg";

function html(node: React.ReactNode) {
  return renderToStaticMarkup(node);
}

/** Copy as it appears in the markup: React escapes quotes, ampersands and angle brackets. */
function text(copy: string) {
  return html(<>{copy}</>);
}

/** Every `<img>` in the markup, as its `src` and `alt` (still escaped). */
function images(markup: string) {
  return [...markup.matchAll(/<img\b[^>]*>/g)].map(([tag]) => ({
    src: tag.match(/ src="([^"]*)"/)?.[1],
    alt: tag.match(/ alt="([^"]*)"/)?.[1],
  }));
}

/** The dossier card's rows as rendered: each `<dt>` with the `<dd>` after it. */
function renderedRows(markup: string) {
  return [...markup.matchAll(/<dt[^>]*>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/gs)].map(
    ([, label, value]) => ({ label, value }),
  );
}

function asRendered(rows: DossierRow[]) {
  return rows.map((row) => ({ label: text(row.label), value: text(row.value) }));
}

/** Rows the fallback does not contain, deliberately not in alphabetical order. */
const ROWS: DossierRow[] = [
  { _key: "r1", label: "Edited label M", value: "Edited value — it's first" },
  { _key: "r2", label: "Edited label Z", value: "Edited value & second" },
  { _key: "r3", label: "Edited label A", value: "Edited value third" },
  { _key: "r4", label: "Edited label K", value: "Edited value fourth" },
];

/** Every text field the section renders, set to copy the fallback does not contain. */
const EDITED: DossierContent = {
  ...LANDING_FALLBACK.dossier,
  heading: "Edited dossier heading",
  body: "Edited dossier body — it's precise & personal.",
  cardTitle: "Edited card title",
  season: "Edited Season",
  rows: ROWS,
  completionLabel: "Edited completion label",
  completionPercent: 37,
};

describe("DossierSection renders its content", () => {
  test("heading, body and the card's title, season and completion", () => {
    const out = html(<DossierSection content={EDITED} />);
    expect(out).toContain(`>${text(EDITED.heading)}</h2>`);
    expect(out).toContain(`>${text(EDITED.body)}<`);
    expect(out).toContain(`>${text(EDITED.cardTitle)}<`);
    expect(out).toContain(`>${text(EDITED.season)}<`);
    expect(out).toContain(`>${text(EDITED.completionLabel)}<`);
    expect(out).toContain(`>${EDITED.completionPercent}%<`);
    expect(out).toContain(`style="width:${EDITED.completionPercent}%"`);
  });

  test("exactly the rows it is given, in the order given", () => {
    const out = html(<DossierSection content={EDITED} />);
    expect(renderedRows(out)).toEqual(asRendered(ROWS));

    const reversed = [...ROWS].reverse();
    const flipped = html(<DossierSection content={{ ...EDITED, rows: reversed }} />);
    expect(renderedRows(flipped)).toEqual(asRendered(reversed));
  });
});

describe("DossierSection image", () => {
  test("a Studio image is rendered with its own URL and alt text", () => {
    const content = normalizeLandingContent(
      { dossier: { image: { url: CDN, alt: 'Edited "dossier" alt' } } },
      TARGET,
    ).dossier;
    // Guard: the Studio image survived validation, so this is not the fallback.
    expect(content.image.src.startsWith(CDN)).toBe(true);

    const out = html(<DossierSection content={content} />);
    expect(images(out)).toEqual([{ src: text(content.image.src), alt: text(content.image.alt) }]);
    expect(out).not.toContain(LANDING_FALLBACK.dossier.image.src);
  });

  test.each([
    ["no image", {}],
    ["an image without alt text", { image: { url: CDN } }],
  ])("with %s, the built-in photograph and its alt text are used", (_case, dossier) => {
    const content = normalizeLandingContent({ dossier }, TARGET).dossier;
    const [img, ...others] = images(html(<DossierSection content={content} />));
    expect(others).toEqual([]);
    expect(img.src).toBe(text(LANDING_FALLBACK.dossier.image.src));
    expect(img.alt).toBe(text(LANDING_FALLBACK.dossier.image.alt));
    expect(img.alt).toMatch(/\S/);
  });
});
