import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AppRole } from "@/lib/authorization";

export interface PendingRoleChange {
  userId: string;
  memberName: string;
  role: AppRole;
  grant: boolean;
}

export function RoleConfirmationDialog({
  change,
  pending,
  onOpenChange,
  onConfirm,
}: {
  change: PendingRoleChange | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const roleName = change?.role === "admin" ? "Steward" : "Moderator";
  return (
    <Dialog open={!!change} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {change?.grant ? "Grant" : "Revoke"} {roleName}
          </DialogTitle>
          <DialogDescription>
            {change?.grant
              ? change.role === "admin"
                ? `${change.memberName} will receive full administrative access, including member and role management.`
                : `${change.memberName} will gain moderation and support access without full administrative access.`
              : change?.role === "admin"
                ? `${change?.memberName}'s full administrative access will be removed.`
                : `${change?.memberName}'s moderation and support access will be removed.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
