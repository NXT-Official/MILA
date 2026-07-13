import type { ColumnDef } from "@tanstack/react-table";
import { UserX, UserCheck, Ellipsis, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import type { AdminUserRow } from "@/lib/admin.functions";

interface MembersColumnsOptions {
  currentUserId?: string;
  pendingRoleChange: boolean;
  onToggleRole: (member: AdminUserRow, role: "admin" | "moderator", grant: boolean) => void;
  onToggleSuspended: (id: string, suspended: boolean) => void;
  onEdit: (member: AdminUserRow) => void;
}

export function getMembersColumns({
  currentUserId,
  pendingRoleChange,
  onToggleRole,
  onToggleSuspended,
  onEdit,
}: MembersColumnsOptions): ColumnDef<AdminUserRow>[] {
  return [
    {
      accessorKey: "full_name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Member" />,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="font-serif text-sm text-ink truncate">
            {row.original.full_name || row.original.username || "Unnamed"}
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-stone mt-0.5">
            {row.original.username ? `@${row.original.username}` : "—"}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "email",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
      cell: ({ row }) => <div className="text-xs text-stone truncate">{row.original.email}</div>,
    },
    {
      accessorKey: "ai_credits",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Credits" className="justify-center w-full" />
      ),
      cell: ({ row }) => (
        <div className="text-center text-sm text-ink">{row.original.ai_credits}</div>
      ),
    },
    {
      id: "steward",
      header: () => <div className="text-center">Steward</div>,
      cell: ({ row }) => (
        <div className="flex justify-center">
          <Switch
            checked={row.original.is_admin}
            disabled={
              pendingRoleChange || (row.original.id === currentUserId && row.original.is_admin)
            }
            aria-label={`Steward role for ${row.original.full_name || row.original.username || "member"}`}
            onCheckedChange={(v) => onToggleRole(row.original, "admin", v)}
          />
        </div>
      ),
    },
    {
      id: "moderator",
      header: () => <div className="text-center">Moderator</div>,
      cell: ({ row }) => (
        <div className="flex justify-center">
          <Switch
            checked={row.original.is_moderator}
            disabled={pendingRoleChange}
            aria-label={`Moderator role for ${row.original.full_name || row.original.username || "member"}`}
            onCheckedChange={(v) => onToggleRole(row.original, "moderator", v)}
          />
        </div>
      ),
    },
    {
      id: "status",
      header: () => <div className="text-right">Status</div>,
      cell: ({ row }) =>
        row.original.suspended ? (
          <div className="flex justify-end">
            <Badge
              variant="outline"
              className="border-destructive/50 text-destructive text-[9px] uppercase tracking-[0.18em]"
            >
              Suspended
            </Badge>
          </div>
        ) : null,
    },
    {
      id: "actions",
      header: () => <div className="text-right sr-only">Actions</div>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="size-8 p-0 text-stone hover:text-ink">
                <Ellipsis className="size-4" strokeWidth={1.75} aria-hidden="true" />
                <span className="sr-only">Open actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(row.original)}>
                <Pencil className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onToggleSuspended(row.original.id, !row.original.suspended)}
              >
                {row.original.suspended ? (
                  <>
                    <UserCheck className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
                    Reinstate
                  </>
                ) : (
                  <>
                    <UserX className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
                    Suspend
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];
}
