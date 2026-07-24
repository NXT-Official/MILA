import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-serif text-sm text-ink truncate">{row.original.title}</span>
            {row.original.archived_at && (
              <Badge
                variant="outline"
                className="border-stone/40 text-stone text-[9px] uppercase tracking-[0.18em]"
              >
                Archived
              </Badge>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-stone mt-0.5 truncate">
            {row.original.slug}
          </div>
        </div>
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
        <div className="flex justify-center">
          <Switch
            checked={row.original.is_active}
            disabled={!!row.original.archived_at}
            aria-label={`${row.original.title} active`}
            onCheckedChange={(v) => onToggleActive(row.original, v)}
          />
        </div>
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
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="size-8 p-0 text-stone hover:text-ink">
                  <Ellipsis className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  <span className="sr-only">Actions for {pack.title}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(pack)}>
                  <Pencil className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onArchive(pack, !archived)}>
                  {archived ? (
                    <>
                      <ArchiveRestore className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
                      Restore
                    </>
                  ) : (
                    <>
                      <Archive className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
                      Archive
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(pack)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];
}
