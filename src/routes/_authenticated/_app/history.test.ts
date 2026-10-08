import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The History route reads Supabase directly, so it isn't rendered under
// bun:test. The filtering is tested in src/lib/history-filter.test.ts and the
// controls in src/components/history; these checks pin the route's wiring.
const source = readFileSync(new URL("./history.tsx", import.meta.url), "utf8");

/** The text of one top-level function, up to the next one. */
function fn(name: string) {
  const start = source.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("History: search, sort and view by style category", () => {
  test("the grid draws the filtered list, not every row", () => {
    const body = fn("History");
    expect(body).toContain("filterHistory(summaries,");
    expect(body).toContain("{visible.map((item) => (");
    expect(body).not.toContain("{items.map((item) => (");
  });

  test("the controls show only when she has something saved", () => {
    const body = fn("History");
    const controls = body.indexOf("<HistoryControls");
    expect(controls).toBeGreaterThan(-1);
    expect(body.lastIndexOf("items.length > 0", controls)).toBeGreaterThan(-1);
  });

  test("a filter that leaves nothing says so instead of showing an empty grid", () => {
    const body = fn("History");
    expect(body).toContain("visible.length === 0 ? (");
    expect(body).toContain("<HistoryNoMatches");
  });

  test("a category she no longer has falls back to All", () => {
    expect(fn("History")).toContain(
      "categories.some((c) => c.id === filter.category) ? filter.category : ALL_CATEGORY",
    );
  });

  test("categories follow the app's own vibe order", () => {
    expect(fn("History")).toContain("historyCategories(summaries, VIBES)");
  });

  test("a look is found by its vibe, weather, notes and the items it suggested", () => {
    const body = fn("historySummary");
    for (const part of [
      "data.vibe",
      "data.weather",
      "data.outfit.description",
      "data.outfit.styling_notes",
      "data.hair.style",
      "pick.title",
    ]) {
      expect(body).toContain(part);
    }
  });

  test("an analysis is found by what it said", () => {
    const body = fn("historySummary");
    for (const part of ["data.verdict", "data.color_match", "data.silhouette"]) {
      expect(body).toContain(part);
    }
  });

  test("a deep link to one look still opens it, whatever the filter shows", () => {
    expect(source).toContain("const match = items.find((i) => i.id === look);");
  });
});
