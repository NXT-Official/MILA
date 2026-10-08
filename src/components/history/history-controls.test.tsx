import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ALL_CATEGORY,
  ANALYSES_CATEGORY,
  DEFAULT_HISTORY_FILTER,
  type HistoryCategory,
  type HistoryFilter,
} from "@/lib/history-filter";
import { HistoryControls, HistoryNoMatches } from "./history-controls";

const CATEGORIES: HistoryCategory[] = [
  { id: ALL_CATEGORY, label: "All", count: 5 },
  { id: "vibe:Brunch", label: "Brunch", count: 2 },
  { id: "vibe:Date Night", label: "Date Night", count: 2 },
  { id: ANALYSES_CATEGORY, label: "Analyses", count: 1 },
];

function controls(filter: Partial<HistoryFilter> = {}, shown = 5) {
  return renderToStaticMarkup(
    <HistoryControls
      filter={{ ...DEFAULT_HISTORY_FILTER, ...filter }}
      categories={CATEGORIES}
      shown={shown}
      total={5}
      onChange={() => {}}
    />,
  );
}

/** The opening tag of the button whose text contains `label`. */
function buttonTag(markup: string, label: string) {
  const button = (markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((b) =>
    b.includes(`>${label}<`),
  );
  expect(button).toBeDefined();
  return (button as string).slice(0, (button as string).indexOf(">") + 1);
}

describe("HistoryControls", () => {
  test("a labelled search field carries her query", () => {
    const out = controls({ query: "linen" });
    expect(out).toContain('for="history-search"');
    expect(out).toMatch(/<input[^>]*id="history-search"[^>]*>/);
    expect(out).toMatch(/<input[^>]*value="linen"[^>]*>/);
    expect(out).toMatch(/<input[^>]*type="search"[^>]*>/);
  });

  test("every style category is a toggle, and only the chosen one is pressed", () => {
    const out = controls({ category: "vibe:Brunch" });
    expect(out).toContain('aria-label="Style category"');
    expect(buttonTag(out, "Brunch")).toContain('aria-pressed="true"');
    expect(buttonTag(out, "All")).toContain('aria-pressed="false"');
    expect(buttonTag(out, "Analyses")).toContain('aria-pressed="false"');
  });

  test("each category says how many it holds", () => {
    const out = controls();
    expect(buttonTag(out, "Date Night")).toContain('aria-label="Date Night, 2 saved"');
  });

  test("the sort control is labelled and shows the current order", () => {
    const out = controls({ sort: "best_fit" });
    expect(out).toContain('id="history-sort-label"');
    expect(out).toContain('aria-labelledby="history-sort-label"');
    expect(out).toContain("Best vibe fit");
  });

  test("the count is announced, and says when the list is narrowed", () => {
    expect(controls()).toContain("5 saved");
    const narrowed = controls({ query: "linen" }, 2);
    expect(narrowed).toContain('role="status"');
    expect(narrowed).toContain("Showing 2 of 5");
  });

  test("a narrowed list offers to clear it; the full list doesn't", () => {
    expect(controls({ category: "vibe:Brunch" }, 2)).toContain("Clear filters");
    expect(controls()).not.toContain("Clear filters");
  });

  test("new copy carries no em or en dashes", () => {
    expect(controls({ query: "x" }, 0)).not.toMatch(/[–—]/);
  });
});

describe("HistoryNoMatches", () => {
  test("names her search and offers a way back to everything", () => {
    const out = renderToStaticMarkup(<HistoryNoMatches query="velvet" onClear={() => {}} />);
    expect(out).toContain("No looks match");
    expect(out).toContain("velvet");
    expect(out).toContain("Clear filters");
    expect(out).toContain('role="status"');
  });

  test("without a search it speaks to the category instead", () => {
    const out = renderToStaticMarkup(<HistoryNoMatches query="  " onClear={() => {}} />);
    expect(out).toContain("Nothing saved in this category");
    expect(out).not.toMatch(/[–—]/);
  });
});
