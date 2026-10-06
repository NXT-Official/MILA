import { Zap } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { outOfCreditsCopy } from "@/lib/out-of-credits-copy";
import { mySubscriptionQueryOptions } from "@/lib/queries/subscriptions";

export function UpgradeSlotsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { user } = useAuth();
  const { data: subscription } = useQuery({
    ...mySubscriptionQueryOptions(user?.id),
    staleTime: 60_000,
  });
  // No plan gets the membership message. A failed subscription read comes back
  // as null too, so it is treated as no plan: harmless, since the button only
  // links to the plans page. While the read is still loading (undefined) the
  // used-up message stays as it was.
  const copy = outOfCreditsCopy({ hasPlan: subscription !== null });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mx-auto sm:mx-0 mb-2 inline-flex items-center justify-center size-12 rounded-full bg-accent/20 ring-1 ring-accent/40">
            <Zap className="size-5 text-foreground" strokeWidth={1.75} />
          </div>
          <DialogTitle className="font-serif text-2xl">{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <Button asChild className="w-full" onClick={() => onOpenChange(false)}>
          <Link to="/pricing">View Membership Plans</Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
