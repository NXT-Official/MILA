import type { ColumnDef } from "@tanstack/react-table";
import { UserX, UserCheck, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionItem, RowActionsMenu, ToggleCell } from "@/components/admin/table-cells";
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
          <div className="text-micro uppercase tracking-label text-stone mt-0.5">
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
        <ToggleCell
          checked={row.original.is_admin}
          disabled={
            pendingRoleChange || (row.original.id === currentUserId && row.original.is_admin)
          }
          label={`Steward role for ${memberLabel(row.original)}`}
          onCheckedChange={(v) => onToggleRole(row.original, "admin", v)}
        />
      ),
    },
    {
      id: "moderator",
      header: () => <div className="text-center">Moderator</div>,
      cell: ({ row }) => (
        <ToggleCell
          checked={row.original.is_moderator}
          disabled={pendingRoleChange}
          label={`Moderator role for ${memberLabel(row.original)}`}
          onCheckedChange={(v) => onToggleRole(row.original, "moderator", v)}
        />
      ),
    },
    {
      id: "status",
      header: () => <div className="text-right">Status</div>,
      cell: ({ row }) =>
        row.original.suspended ? (
          <div className="flex justify-end">
            <Badge className="border-destructive/50 text-destructive text-nano uppercase tracking-label">
              Suspended
            </Badge>
          </div>
        ) : null,
    },
    {
      id: "actions",
      header: () => <div className="text-right sr-only">Actions</div>,
      cell: ({ row }) => (
        <RowActionsMenu label="Open actions">
          <ActionItem icon={Pencil} label="Edit" onClick={() => onEdit(row.original)} />
          <ActionItem
            icon={row.original.suspended ? UserCheck : UserX}
            label={row.original.suspended ? "Reinstate" : "Suspend"}
            onClick={() => onToggleSuspended(row.original.id, !row.original.suspended)}
          />
        </RowActionsMenu>
      ),
    },
  ];
}

function memberLabel(member: AdminUserRow): string {
  return member.full_name || member.username || "member";
}
