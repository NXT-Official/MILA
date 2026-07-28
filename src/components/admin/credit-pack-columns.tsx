import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";

import {
  ActionItem,
  CatalogTitleCell,
  RowActionsMenu,
  ToggleCell,
} from "@/components/admin/table-cells";
import { formatPlanPrice } from "@/lib/subscription-plans";
import type { CreditPack } from "@/lib/credit-packs";

interface CreditPackColumnsOptions {
  onEdit: (pack: CreditPack) => void;
  onToggleActive: (pack: CreditPack, active: boolean) => void;
  onArchive: (pack: CreditPack, archived: boolean) => void;
  onDelete: (pack: CreditPack) => void;
}

export function getCreditPackColumns({
  onEdit,
  onToggleActive,
  onArchive,
  onDelete,
}: CreditPackColumnsOptions): ColumnDef<CreditPack>[] {
  return [
    {
      accessorKey: "title",
      header: () => <span>Pack</span>,
      cell: ({ row }) => (
        <CatalogTitleCell
          title={row.original.title}
          slug={row.original.slug}
          archived={!!row.original.archived_at}
        />
      ),
    },
    {
      accessorKey: "price_amount",
      header: () => <span>Price</span>,
      cell: ({ row }) => (
        <div className="text-sm text-ink tabular-nums">
          {formatPlanPrice(row.original.price_amount, row.original.currency)}
        </div>
      ),
    },
    {
      accessorKey: "credits",
      header: () => <div className="text-center">Credits</div>,
      cell: ({ row }) => (
        <div className="text-center text-sm text-ink tabular-nums">{row.original.credits}</div>
      ),
    },
    {
      id: "active",
      header: () => <div className="text-center">Active</div>,
      cell: ({ row }) => (
        <ToggleCell
          checked={row.original.is_active}
          disabled={!!row.original.archived_at}
          label={`${row.original.title} active`}
          onCheckedChange={(v) => onToggleActive(row.original, v)}
        />
      ),
    },
    {
      accessorKey: "updated_at",
      header: () => <span>Updated</span>,
      cell: ({ row }) => (
        <span className="text-xs text-stone whitespace-nowrap">
          {new Date(row.original.updated_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const pack = row.original;
        const archived = !!pack.archived_at;
        return (
          <RowActionsMenu label={`Actions for ${pack.title}`}>
            <ActionItem icon={Pencil} label="Edit" onClick={() => onEdit(pack)} />
            <ActionItem
              icon={archived ? ArchiveRestore : Archive}
              label={archived ? "Restore" : "Archive"}
              onClick={() => onArchive(pack, !archived)}
            />
            <ActionItem icon={Trash2} label="Delete" destructive onClick={() => onDelete(pack)} />
          </RowActionsMenu>
        );
      },
    },
  ];
}
