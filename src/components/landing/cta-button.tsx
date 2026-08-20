import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CtaButton({
  className,
  inverted = false,
}: {
  className?: string;
  /** For the drenched section, where an Ink button would vanish into the ground. */
  inverted?: boolean;
}) {
  return (
    <Button
      asChild
      size="lg"
      className={cn(
        "group rounded-full px-8 text-xs uppercase tracking-label",
        inverted && "bg-drench-foreground text-drench hover:bg-drench-foreground/90",
        className,
      )}
    >
      <Link to="/login">
        Get your first look
        {/* The arrow answers the press before the route does. */}
        <ArrowRight
          className={cn(
            "ml-2 size-4 transition-transform duration-200 ease-editorial group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0",
            // Champagne holds 1.97:1 on a light ground — on the inverted button it
            // would be invisible, so the arrow takes the ground's own ink instead.
            inverted ? "text-drench" : "text-accent",
          )}
          aria-hidden="true"
        />
      </Link>
    </Button>
  );
}
