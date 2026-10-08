/**
 * History's search, sort and view-by-style-category, as pure functions.
 *
 * Shared verbatim with Mila Mobile (`src/lib/history-filter.ts`): both clients
 * normalise their own `outfits` rows into a `HistorySummary`, then make the
 * same calls here, so one member sees the same archive on both.
 *
 * A look's style category is its vibe, the occasion it was composed for. A Lens
 * analysis has none and gets its own view; a row neither client can read shows
 * only under All.
 */

export type HistorySummary = {
  id: string;
  /** ISO timestamp the row was saved. */
  createdAt: string;
  title: string;
  kind: "look" | "analysis" | "other";
  /** The look's vibe; null for an analysis or an unreadable row. */
  category: string | null;
  /** The look's vibe fit (1 to 10); null when the row carries none. */
  score: number | null;
  /** Everything a search should find, already folded by `searchTextOf`. */
  searchText: string;
};

export const HISTORY_SORTS = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "best_fit", label: "Best vibe fit" },
  { id: "title", label: "Name A to Z" },
] as const;

export type HistorySort = (typeof HISTORY_SORTS)[number]["id"];

export const ALL_CATEGORY = "all";
export const ANALYSES_CATEGORY = "analyses";

export type HistoryCategory = { id: string; label: string; count: number };

export type HistoryFilter = { query: string; category: string; sort: HistorySort };

export const DEFAULT_HISTORY_FILTER: HistoryFilter = {
  query: "",
  category: ALL_CATEGORY,
  sort: "newest",
};

/** Lower case with accents removed, so "Café" and "cafe" are the same word. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** The searchable text of one entry, from whichever parts it has. */
export function searchTextOf(parts: readonly unknown[]): string {
  // Parts come from stored rows, so anything that is not text is skipped.
  return fold(
    parts.filter((part): part is string => typeof part === "string" && !!part.trim()).join(" \n "),
  );
}

/** Every word of the query must appear somewhere in the entry. */
export function searchHistory(entries: readonly HistorySummary[], query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((entry) => words.every((word) => entry.searchText.includes(word)));
}

/** An unreadable date sorts as the oldest rather than jumping to the top. */
function savedAt(entry: HistorySummary): number {
  const time = Date.parse(entry.createdAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function newestFirst(a: HistorySummary, b: HistorySummary): number {
  const diff = savedAt(b) - savedAt(a);
  return Number.isNaN(diff) ? 0 : diff;
}

function compareText(a: string, b: string): number {
  const left = fold(a);
  const right = fold(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A sorted copy; ties fall back to newest first. */
export function sortHistory(entries: readonly HistorySummary[], sort: HistorySort) {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    if (sort === "oldest") return -newestFirst(a, b) || 0;
    if (sort === "best_fit") {
      const byScore = (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY);
      if (byScore && !Number.isNaN(byScore)) return byScore;
    }
    if (sort === "title") {
      const byTitle = compareText(a.title, b.title);
      if (byTitle) return byTitle;
    }
    return newestFirst(a, b);
  });
  return sorted;
}

function vibeCategoryId(vibe: string): string {
  return `vibe:${vibe}`;
}

/**
 * The views she can pick: All, each vibe she has a look in (in the app's own
 * vibe order, then any vibe it no longer offers), and Analyses when she has one.
 */
export function historyCategories(
  entries: readonly HistorySummary[],
  vibeOrder: readonly string[],
): HistoryCategory[] {
  const counts = new Map<string, number>();
  let analyses = 0;
  for (const entry of entries) {
    if (entry.kind === "analysis") analyses += 1;
    else if (entry.category) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }

  const known = vibeOrder.filter((vibe) => counts.has(vibe));
  const legacy = [...counts.keys()].filter((vibe) => !vibeOrder.includes(vibe)).sort(compareText);

  return [
    { id: ALL_CATEGORY, label: "All", count: entries.length },
    ...[...known, ...legacy].map((vibe) => ({
      id: vibeCategoryId(vibe),
      label: vibe,
      count: counts.get(vibe) ?? 0,
    })),
    ...(analyses > 0 ? [{ id: ANALYSES_CATEGORY, label: "Analyses", count: analyses }] : []),
  ];
}

function inCategory(entry: HistorySummary, category: string): boolean {
  if (category === ALL_CATEGORY) return true;
  if (category === ANALYSES_CATEGORY) return entry.kind === "analysis";
  return entry.category !== null && vibeCategoryId(entry.category) === category;
}

/** The one call a History screen makes: view, then search, then order. */
export function filterHistory(entries: readonly HistorySummary[], filter: HistoryFilter) {
  const inView = entries.filter((entry) => inCategory(entry, filter.category));
  return sortHistory(searchHistory(inView, filter.query), filter.sort);
}

/** True when anything narrows the list, so the screen can offer to clear it. */
export function isHistoryFiltered(filter: HistoryFilter): boolean {
  return filter.query.trim() !== "" || filter.category !== ALL_CATEGORY;
}
