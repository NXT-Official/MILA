import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { getMembersColumns } from "@/components/admin/members-columns";
import { MemberFormDialog } from "@/components/admin/member-form-dialog";
import { useAuth } from "@/hooks/use-auth";
import { queryKeys } from "@/constants/query-keys";
import { adminSetUserRole, adminSetSuspended, type AdminUserRow } from "@/lib/admin.functions";
import { adminMembersQueryOptions } from "@/lib/queries/admin";
import { requireStaffRoutePermission } from "@/lib/staff-route";
import {
  RoleConfirmationDialog,
  type PendingRoleChange,
} from "@/components/admin/role-confirmation-dialog";

export const Route = createFileRoute("/_authenticated/admin/members")({
  beforeLoad: ({ context }) => requireStaffRoutePermission(context.queryClient, "members.view"),
  component: MembersPage,
});

function MembersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const setRole = useServerFn(adminSetUserRole);
  const setSuspended = useServerFn(adminSetSuspended);
  const [formOpen, setFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<AdminUserRow | undefined>(undefined);
  const [roleChange, setRoleChange] = useState<PendingRoleChange | null>(null);
  const [rolePending, setRolePending] = useState(false);

  const { data, isLoading } = useQuery(adminMembersQueryOptions());

  function openCreate() {
    setEditingMember(undefined);
    setFormOpen(true);
  }

  function openEdit(member: AdminUserRow) {
    setEditingMember(member);
    setFormOpen(true);
  }

  function requestRoleChange(member: AdminUserRow, role: "admin" | "moderator", grant: boolean) {
    setRoleChange({
      userId: member.id,
      memberName: member.full_name || member.username || member.email || "This member",
      role,
      grant,
    });
  }

  async function confirmRoleChange() {
    if (!roleChange) return;
    setRolePending(true);
    try {
      const result = await setRole({
        data: { user_id: roleChange.userId, role: roleChange.role, grant: roleChange.grant },
      });
      const label = roleChange.role === "admin" ? "Steward" : "Moderator";
      toast.success(
        result.status === "already_assigned"
          ? `This member already has the ${label} role.`
          : result.status === "not_assigned"
            ? `This member does not have the ${label} role.`
            : `${label} role ${roleChange.grant ? "granted" : "revoked"}.`,
      );
      await qc.invalidateQueries({ queryKey: queryKeys.adminUsers });
      setRoleChange(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update role.");
    } finally {
      setRolePending(false);
    }
  }

  async function toggleSuspended(id: string, suspended: boolean) {
    try {
      await setSuspended({ data: { user_id: id, suspended } });
      toast.success(suspended ? "Member suspended." : "Member reinstated.");
      qc.invalidateQueries({ queryKey: queryKeys.adminUsers });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update status.");
    }
  }

  const columns = getMembersColumns({
    currentUserId: user?.id,
    pendingRoleChange: rolePending,
    onToggleRole: requestRoleChange,
    onToggleSuspended: toggleSuspended,
    onEdit: openEdit,
  });

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-panel border border-porcelain/60 px-4 py-3 text-xs text-stone">
          <strong className="block text-ink">Steward</strong>
          Full administrative access, including member and role management.
        </div>
        <div className="rounded-panel border border-porcelain/60 px-4 py-3 text-xs text-stone">
          <strong className="block text-ink">Moderator</strong>
          Access to moderation and support tools without full administrative control.
        </div>
      </div>
      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        searchable
        searchPlaceholder="Search by name, username, or email"
        searchText={(u) => `${u.full_name ?? ""} ${u.username ?? ""} ${u.email ?? ""}`}
        countLabel="members"
        emptyMessage="No members found."
        action={
          <Button size="sm" className="h-9 text-xs gap-1.5" onClick={openCreate}>
            <Plus className="size-3.5" />
            Add Member
          </Button>
        }
      />

      <MemberFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        member={editingMember}
        onSaved={() => qc.invalidateQueries({ queryKey: queryKeys.adminUsers })}
      />
      <RoleConfirmationDialog
        change={roleChange}
        pending={rolePending}
        onOpenChange={(open) => !open && !rolePending && setRoleChange(null)}
        onConfirm={confirmRoleChange}
      />
    </div>
  );
}
