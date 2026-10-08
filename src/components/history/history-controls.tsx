import { SearchX, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_HISTORY_FILTER,
  HISTORY_SORTS,
  isHistoryFiltered,
  type HistoryCategory,
  type HistoryFilter,
  type HistorySort,
} from "@/lib/history-filter";
import { cn } from "@/lib/utils";

const LABEL = "mb-2 block text-xs font-medium uppercase tracking-label text-muted-foreground";

/**
 * Search, sort and view-by-style-category above History's grid. The filtering
 * itself is `filterHistory` (shared with mobile); this only draws the controls
 * and reports what she picked.
 */
export function HistoryControls({
  filter,
  categories,
  shown,
  total,
  onChange,
}: {
  filter: HistoryFilter;
  categories: HistoryCategory[];
  /** How many entries the current filter leaves. */
  shown: number;
  total: number;
  onChange: (next: HistoryFilter) => void;
}) {
  const sortLabel = HISTORY_SORTS.find((s) => s.id === filter.sort)?.label ?? "";
  const filtered = isHistoryFiltered(filter);

  return (
    <div className="mb-6 space-y-4 sm:mb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="history-search" className={LABEL}>
            Search
          </label>
          <Input
            id="history-search"
            type="search"
            leadingIcon={Search}
            value={filter.query}
            onChange={(e) => onChange({ ...filter, query: e.target.value })}
            placeholder="A look, a piece, a vibe or the weather"
            autoComplete="off"
            // No text-sm here: the field keeps Input's 16px on phones, so iOS
            // Safari doesn't zoom the page when she taps into it.
            className="h-11 rounded-full border-border bg-card"
          />
        </div>
        <div className="sm:w-56">
          <span id="history-sort-label" className={LABEL}>
            Sort
          </span>
          <Select
            value={filter.sort}
            onValueChange={(v) => onChange({ ...filter, sort: v as HistorySort })}
          >
            <SelectTrigger
              aria-labelledby="history-sort-label"
              className="h-11 rounded-full border-border bg-card text-sm"
            >
              <SelectValue>{sortLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {HISTORY_SORTS.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-sm">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div role="group" aria-label="Style category" className="flex flex-wrap gap-2">
        {categories.map((category) => {
          const active = category.id === filter.category;
          return (
            <button
              key={category.id}
              type="button"
              aria-pressed={active}
              aria-label={`${category.label}, ${category.count} saved`}
              onClick={() => onChange({ ...filter, category: category.id })}
              className={cn(
                "inline-flex min-h-9 items-center gap-2 rounded-full border px-4 text-xs uppercase tracking-label transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
              )}
            >
              <span>{category.label}</span>
              <span aria-hidden="true" className="tabular-nums opacity-70">
                {category.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {filtered ? `Showing ${shown} of ${total}` : `${total} saved`}
        </p>
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...DEFAULT_HISTORY_FILTER, sort: filter.sort })}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The grid's place when her search or category leaves nothing. */
export function HistoryNoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  const searched = query.trim();
  return (
    <EmptyState
      role="status"
      className="mx-auto max-w-xl"
      icon={<SearchX className="size-8" strokeWidth={1.25} />}
      title={searched ? "No looks match" : "Nothing saved in this category"}
      description={
        searched
          ? `Nothing in this view mentions “${searched}”. Try fewer words, or clear the search.`
          : "Pick another category, or show everything."
      }
      action={
        <Button variant="outline" size="pill" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  );
}
