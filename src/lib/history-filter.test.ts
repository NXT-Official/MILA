import { describe, expect, test } from "bun:test";
import {
  ALL_CATEGORY,
  ANALYSES_CATEGORY,
  filterHistory,
  historyCategories,
  isHistoryFiltered,
  searchHistory,
  searchTextOf,
  sortHistory,
  type HistorySummary,
} from "./history-filter";

const VIBES = ["Everyday Casual", "Work or School", "Brunch", "Date Night"] as const;

function look(
  id: string,
  createdAt: string,
  title: string,
  category: string | null,
  score: number | null,
  extra: string[] = [],
): HistorySummary {
  return {
    id,
    createdAt,
    title,
    kind: "look",
    category,
    score,
    searchText: searchTextOf([title, category, ...extra]),
  };
}

const LINEN = look("a", "2026-10-01T09:00:00Z", "Linen Day", "Brunch", 8, [
  "Wide-leg linen trousers",
  "Partly Cloudy (Manila)",
  "Striped Cotton Jacket",
]);
const BLAZER = look("b", "2026-10-03T09:00:00Z", "Soft Tailoring", "Work or School", 9, [
  "Unstructured blazer",
]);
const SLIP = look("c", "2026-09-20T20:00:00Z", "Café Slip Dress", "Date Night", null, [
  "Bias-cut satin",
]);
const ANALYSIS: HistorySummary = {
  id: "d",
  createdAt: "2026-10-02T12:00:00Z",
  title: "Outfit Analysis",
  kind: "analysis",
  category: null,
  score: null,
  searchText: searchTextOf(["Outfit Analysis", "The navy reads cool against warm skin."]),
};
const ODD: HistorySummary = {
  id: "e",
  createdAt: "2026-09-01T00:00:00Z",
  title: "Saved Look",
  kind: "other",
  category: null,
  score: null,
  searchText: searchTextOf(["Saved Look"]),
};
const ALL = [LINEN, BLAZER, SLIP, ANALYSIS, ODD];
const ids = (entries: HistorySummary[]) => entries.map((e) => e.id);

describe("searchHistory", () => {
  test("an empty or blank query keeps everything, in order", () => {
    expect(ids(searchHistory(ALL, ""))).toEqual(ids(ALL));
    expect(ids(searchHistory(ALL, "   "))).toEqual(ids(ALL));
  });

  test("matches the title, ignoring case", () => {
    expect(ids(searchHistory(ALL, "linen DAY"))).toEqual(["a"]);
  });

  test("finds a look by an item it suggested and by its weather", () => {
    expect(ids(searchHistory(ALL, "striped jacket"))).toEqual(["a"]);
    expect(ids(searchHistory(ALL, "manila"))).toEqual(["a"]);
  });

  test("every word must appear, in any order", () => {
    expect(ids(searchHistory(ALL, "jacket linen"))).toEqual(["a"]);
    expect(ids(searchHistory(ALL, "linen blazer"))).toEqual([]);
  });

  test("accents don't matter either way", () => {
    expect(ids(searchHistory(ALL, "cafe"))).toEqual(["c"]);
    expect(ids(searchHistory(ALL, "café"))).toEqual(["c"]);
  });

  test("finds an analysis by what it said", () => {
    expect(ids(searchHistory(ALL, "navy"))).toEqual(["d"]);
  });

  test("finds looks by their style category", () => {
    expect(ids(searchHistory(ALL, "date night"))).toEqual(["c"]);
  });

  test("a damaged row's non-text parts are skipped, not thrown on", () => {
    expect(searchTextOf(["Linen", 7, null, { a: 1 }, undefined, "  ", "Day"])).toBe("linen \n day");
  });
});

describe("isHistoryFiltered", () => {
  test("a search or a category narrows the list; a sort alone doesn't", () => {
    expect(isHistoryFiltered({ query: "", category: ALL_CATEGORY, sort: "oldest" })).toBe(false);
    expect(isHistoryFiltered({ query: "  ", category: ALL_CATEGORY, sort: "newest" })).toBe(false);
    expect(isHistoryFiltered({ query: "linen", category: ALL_CATEGORY, sort: "newest" })).toBe(
      true,
    );
    expect(isHistoryFiltered({ query: "", category: "vibe:Brunch", sort: "newest" })).toBe(true);
  });
});

describe("sortHistory", () => {
  test("newest first is the default order", () => {
    expect(ids(sortHistory(ALL, "newest"))).toEqual(["b", "d", "a", "c", "e"]);
  });

  test("oldest first", () => {
    expect(ids(sortHistory(ALL, "oldest"))).toEqual(["e", "c", "a", "d", "b"]);
  });

  test("best vibe fit puts unscored entries last, newest first among them", () => {
    expect(ids(sortHistory(ALL, "best_fit"))).toEqual(["b", "a", "d", "c", "e"]);
  });

  test("name A to Z ignores case and accents", () => {
    expect(ids(sortHistory(ALL, "title"))).toEqual(["c", "a", "d", "e", "b"]);
  });

  test("equal keys fall back to newest first", () => {
    const twin = { ...LINEN, id: "a2", createdAt: "2026-10-05T09:00:00Z" };
    expect(ids(sortHistory([LINEN, twin], "title"))).toEqual(["a2", "a"]);
  });

  test("an unreadable date sorts as the oldest, never first", () => {
    const broken = { ...LINEN, id: "x", createdAt: "not a date" };
    expect(ids(sortHistory([broken, LINEN], "newest"))).toEqual(["a", "x"]);
  });

  test("never reorders the list it was given", () => {
    const input = [...ALL];
    sortHistory(input, "oldest");
    expect(ids(input)).toEqual(ids(ALL));
  });
});

describe("historyCategories", () => {
  test("All first, then the vibes she has in the app's order, then analyses", () => {
    expect(historyCategories(ALL, VIBES)).toEqual([
      { id: ALL_CATEGORY, label: "All", count: 5 },
      { id: "vibe:Work or School", label: "Work or School", count: 1 },
      { id: "vibe:Brunch", label: "Brunch", count: 1 },
      { id: "vibe:Date Night", label: "Date Night", count: 1 },
      { id: ANALYSES_CATEGORY, label: "Analyses", count: 1 },
    ]);
  });

  test("a vibe the app no longer offers still gets its own view, after the known ones", () => {
    const legacy = look("f", "2026-08-01T00:00:00Z", "Old", "Festival", 7);
    const cats = historyCategories([LINEN, legacy], VIBES).map((c) => c.label);
    expect(cats).toEqual(["All", "Brunch", "Festival"]);
  });

  test("no Analyses view when she has none", () => {
    expect(historyCategories([LINEN], VIBES).map((c) => c.id)).not.toContain(ANALYSES_CATEGORY);
  });

  test("counts every look in a vibe", () => {
    const brunch2 = look("g", "2026-10-06T00:00:00Z", "Garden", "Brunch", 6);
    const brunch = historyCategories([LINEN, brunch2], VIBES).find((c) => c.label === "Brunch");
    expect(brunch?.count).toBe(2);
  });
});

describe("filterHistory", () => {
  test("defaults show everything newest first", () => {
    expect(ids(filterHistory(ALL, { query: "", category: ALL_CATEGORY, sort: "newest" }))).toEqual([
      "b",
      "d",
      "a",
      "c",
      "e",
    ]);
  });

  test("a vibe view shows only that vibe's looks", () => {
    expect(ids(filterHistory(ALL, { query: "", category: "vibe:Brunch", sort: "newest" }))).toEqual(
      ["a"],
    );
  });

  test("the Analyses view shows only analyses", () => {
    expect(
      ids(filterHistory(ALL, { query: "", category: ANALYSES_CATEGORY, sort: "newest" })),
    ).toEqual(["d"]);
  });

  test("search, category and sort combine", () => {
    const more = [...ALL, look("h", "2026-10-07T00:00:00Z", "Linen Again", "Brunch", 5, ["linen"])];
    expect(
      ids(filterHistory(more, { query: "linen", category: "vibe:Brunch", sort: "best_fit" })),
    ).toEqual(["a", "h"]);
  });

  test("a category she no longer has shows nothing rather than everything", () => {
    expect(ids(filterHistory(ALL, { query: "", category: "vibe:Party", sort: "newest" }))).toEqual(
      [],
    );
  });
});
