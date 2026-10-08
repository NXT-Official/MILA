import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { SavedPalette } from "@/lib/queries/saved-palettes";
import { PaletteCard, PalettesEmptyState } from "./palette-card";

const ROW: SavedPalette = {
  id: "p1",
  created_at: "2026-10-07T00:00:00Z",
  palette: {
    baseColor: "Charcoal",
    statementColor: "Rust",
    accentColor: "Camel",
    baseHex: "#36454F",
    statementHex: "#B7410E",
    accentHex: "#C19A6B",
    isSisterSeasonIncluded: false,
    styleVibe: "From your colors",
    insight: "Wear Charcoal on your bottoms or a jacket.",
    source: "swatches",
  },
};

async function render(node: React.ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <>{node}</> }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("palettes page", () => {
  test("each saved palette shows its wear lines", async () => {
    const markup = await render(<PaletteCard row={ROW} onDelete={async () => {}} />);
    for (const text of ["Base", "Statement", "Accent", "Charcoal", "Rust", "Camel"]) {
      expect(markup).toContain(text);
    }
    for (const line of ["Bottoms or a jacket", "Top, near your face", "Shoes, bag or jewelry"]) {
      expect(markup).toContain(line);
    }
    expect(markup).not.toContain("Base Layer");
    expect(markup).not.toContain("Accent Pop");
    expect(markup).not.toMatch(/[–—]/);
  });

  test("an older saved palette without a source still shows its wear lines", async () => {
    const { source: _source, ...older } = ROW.palette;
    const markup = await render(
      <PaletteCard row={{ ...ROW, palette: older }} onDelete={async () => {}} />,
    );
    expect(markup).toContain("Shoes, bag or jewelry");
  });

  test("the empty state offers Make today's palette", async () => {
    const markup = await render(<PalettesEmptyState />);
    expect(markup).toContain("No palettes saved yet");
    expect(markup).toContain("Make today&#x27;s palette");
    expect(markup).toContain('href="/dashboard"');
  });
});
