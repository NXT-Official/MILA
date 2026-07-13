import { Construction } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DevelopmentBadge } from "@/components/ui/development-badge";

/**
 * Full-route replacement for a page that isn't ready yet. Use instead of
 * rendering a broken or half-built interface underneath.
 */
export function DevelopmentPage({
  title,
  description,
  returnTo = "/dashboard",
  returnLabel = "Return to dashboard",
}: {
  title: string;
  description: string;
  returnTo?: "/dashboard" | "/admin";
  returnLabel?: string;
}) {
  return (
    <div className="mila-page flex min-h-screen items-center justify-center px-6">
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full border border-line bg-accent-soft/60">
          <Construction className="size-6 text-accent" aria-hidden="true" strokeWidth={1.5} />
        </div>
        <div className="mb-4 flex justify-center">
          <DevelopmentBadge />
        </div>
        <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{description}</p>
        <Button asChild className="mt-8">
          <Link to={returnTo}>{returnLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
