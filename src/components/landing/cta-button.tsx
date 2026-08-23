import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CtaButton({
  className,
  onNavigate,
}: {
  className?: string;
  /** Lets an overlay that contains the CTA — the mobile menu — close itself. */
  onNavigate?: () => void;
}) {
  return (
    <Button
      asChild
      size="lg"
      className={cn("group rounded-full px-8 text-xs uppercase tracking-label", className)}
    >
      <Link to="/login" onClick={onNavigate}>
        Get your first look
        {/* The arrow answers the press before the route does. */}
        <ArrowRight
          className="ml-2 size-4 text-accent transition-transform duration-200 ease-editorial group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
          aria-hidden="true"
        />
      </Link>
    </Button>
  );
}
