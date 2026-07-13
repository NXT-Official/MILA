import type { Column } from "@tanstack/react-table";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DataTableColumnHeaderProps<TData, TValue> extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={className}>{title}</div>;
  }

  const sorted = column.getIsSorted();

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-3 h-8 text-inherit hover:bg-transparent hover:text-ink", className)}
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {title}
      {sorted === "asc" ? (
        <ArrowUp className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <ArrowUpDown className="size-3.5 opacity-50" strokeWidth={1.75} aria-hidden="true" />
      )}
    </Button>
  );
}
