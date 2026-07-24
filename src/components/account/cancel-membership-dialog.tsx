import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CancelMembershipDialog({
  open,
  endsAt,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  endsAt: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel your membership?</DialogTitle>
          <DialogDescription>
            You'll keep access until {new Date(endsAt).toLocaleDateString()}. After that, your
            plan won't renew.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep Membership
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={pending}>
            Cancel Membership
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
