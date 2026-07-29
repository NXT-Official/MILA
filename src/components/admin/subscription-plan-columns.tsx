import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import {
  ActionItem,
  CatalogTitleCell,
  RowActionsMenu,
  ToggleCell,
} from "@/components/admin/table-cells";
import {
  BILLING_INTERVAL_LABELS,
  formatPlanPrice,
  type SubscriptionPlan,
} from "@/lib/subscription-plans";

interface SubscriptionPlanColumnsOptions {
  onEdit: (plan: SubscriptionPlan) => void;
  onToggleActive: (plan: SubscriptionPlan, active: boolean) => void;
  onToggleFeatured: (plan: SubscriptionPlan, featured: boolean) => void;
  onMove: (plan: SubscriptionPlan, direction: -1 | 1) => void;
  onArchive: (plan: SubscriptionPlan, archived: boolean) => void;
  onDelete: (plan: SubscriptionPlan) => void;
}

export function getSubscriptionPlanColumns({
  onEdit,
  onToggleActive,
  onToggleFeatured,
  onMove,
  onArchive,
  onDelete,
}: SubscriptionPlanColumnsOptions): ColumnDef<SubscriptionPlan>[] {
  return [
    {
      id: "order",
      header: () => <span>Order</span>,
      cell: ({ row, table }) => {
        const last = table.getRowModel().rows.length - 1;
        return (
          <div className="flex items-center gap-1">
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => onMove(row.original, -1)}
                disabled={row.index === 0}
                aria-label={`Move ${row.original.title} up`}
                className="text-stone hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronUp className="size-3.5" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => onMove(row.original, 1)}
                disabled={row.index === last}
                aria-label={`Move ${row.original.title} down`}
                className="text-stone hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </button>
            </div>
            <span className="text-xs text-stone tabular-nums">{row.index + 1}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "title",
      header: () => <span>Plan</span>,
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
        <div>
          <div className="text-sm text-ink tabular-nums">
            {formatPlanPrice(row.original.price_amount, row.original.currency)}
          </div>

          <div className="text-micro uppercase tracking-label text-stone mt-0.5">
            {BILLING_INTERVAL_LABELS[row.original.billing_interval]}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "credits_included",
      header: () => <div className="text-center">Credits</div>,
      cell: ({ row }) => (
        <div className="text-center text-sm text-ink tabular-nums">
          {row.original.credits_included}
        </div>
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
      id: "featured",
      header: () => <div className="text-center">Featured</div>,
      cell: ({ row }) => (
        <ToggleCell
          checked={row.original.is_featured}
          disabled={!!row.original.archived_at}
          label={`${row.original.title} featured`}
          onCheckedChange={(v) => onToggleFeatured(row.original, v)}
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
        const plan = row.original;
        const archived = !!plan.archived_at;
        return (
          <RowActionsMenu label={`Actions for ${plan.title}`}>
            <ActionItem icon={Pencil} label="Edit" onClick={() => onEdit(plan)} />
            <ActionItem
              icon={archived ? ArchiveRestore : Archive}
              label={archived ? "Restore" : "Archive"}
              onClick={() => onArchive(plan, !archived)}
            />
            <ActionItem icon={Trash2} label="Delete" destructive onClick={() => onDelete(plan)} />
          </RowActionsMenu>
        );
      },
    },
  ];
}
