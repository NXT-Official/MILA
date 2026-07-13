import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Inbox, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Enables the search input, filtering rows by their stringified values (or `searchText` if provided). */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Custom text to search per row. Defaults to a stringified dump of the row. */
  searchText?: (row: TData) => string;
  /** Noun shown next to the row count, e.g. "members". */
  countLabel?: string;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Replaces the row count with custom content, e.g. an "Add" button. */
  action?: React.ReactNode;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchable = false,
  searchPlaceholder = "Filter...",
  searchText,
  countLabel = "results",
  isLoading,
  emptyMessage = "No results.",
  action,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const haystack = searchText ? searchText(row.original) : JSON.stringify(row.original);
      return haystack.toLowerCase().includes(String(filterValue).toLowerCase());
    },
    state: { sorting, globalFilter },
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        {searchable ? (
          <Input
            leadingIcon={Search}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="max-w-sm bg-background border-porcelain/60 rounded-full text-sm"
          />
        ) : (
          <div />
        )}
        {action ?? (
          <div className="text-[10px] uppercase tracking-[0.22em] text-stone">
            {isLoading ? "Loading…" : `${table.getFilteredRowModel().rows.length} ${countLabel}`}
          </div>
        )}
      </div>

      <div className="rounded-panel border border-porcelain/60 bg-atelier-panel/40 overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-porcelain/40 hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="h-auto px-5 py-3 text-[9px] uppercase tracking-[0.22em] text-stone"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow className="border-porcelain/30 hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-24 text-center text-sm text-stone">
                  Loading…
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="border-porcelain/30 transition-colors last:border-0 hover:bg-background/40"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-5 py-4">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="border-porcelain/30 hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-32 text-center text-sm text-stone">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="size-6 text-muted" strokeWidth={1.75} aria-hidden="true" />
                    {emptyMessage}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-end gap-2 py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
