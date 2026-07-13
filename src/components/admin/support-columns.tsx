import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Circle } from "lucide-react";

import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import type { AdminSupportMessageRow } from "@/lib/admin.functions";

interface SupportColumnsOptions {
  onToggleResolved: (id: string, resolved: boolean) => void;
}

export function getSupportColumns({
  onToggleResolved,
}: SupportColumnsOptions): ColumnDef<AdminSupportMessageRow>[] {
  return [
    {
      accessorKey: "message",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Message" />,
      cell: ({ row }) => (
        <p
          className={`max-w-xl text-sm leading-relaxed ${row.original.resolved ? "text-stone line-through" : "text-ink"}`}
        >
          {row.original.message}
        </p>
      ),
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Received" />,
      cell: ({ row }) => (
        <div className="text-[10px] uppercase tracking-[0.18em] text-stone whitespace-nowrap">
          {new Date(row.original.created_at).toLocaleString()}
        </div>
      ),
    },
    {
      id: "status",
      header: () => <div className="text-right">Status</div>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onToggleResolved(row.original.id, !row.original.resolved)}
            title={row.original.resolved ? "Mark unresolved" : "Mark resolved"}
            className="text-stone hover:text-ink transition-colors"
          >
            {row.original.resolved ? (
              <CheckCircle2 className="size-4 text-success" />
            ) : (
              <Circle className="size-4" />
            )}
          </button>
        </div>
      ),
    },
  ];
}
