import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { savedProductsQueryOptions } from "@/lib/queries/saved-products";
import { cn } from "@/lib/utils";

/** True once the member's saved list loaded; false while signed out, loading or unavailable. */
function useSavedPiecesAvailable(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({ ...savedProductsQueryOptions(user?.id), enabled: !!user });
  return !!user && data?.status === "ready";
}

/**
 * A lasting way back to /saved on every width (the sidebar is desktop only).
 * Hidden with the Save buttons when saved pieces are not available yet, so it
 * never leads to a feature she cannot use.
 */
export function SavedPiecesLink({ className }: { className?: string }) {
  const available = useSavedPiecesAvailable();
  if (!available) return null;
  return (
    <Link
      to="/saved"
      className={cn(
        "atelier-focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-micro uppercase tracking-label-wide text-muted-foreground transition-colors hover:text-ink",
        className,
      )}
    >
      <Bookmark className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      Saved pieces
    </Link>
  );
}

/** The same destination as a row under the account sections list. */
export function SavedPiecesAccountRow() {
  const available = useSavedPiecesAvailable();
  if (!available) return null;
  return (
    <Link
      to="/saved"
      className="atelier-focus-ring mt-4 flex min-h-12 w-full items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3 text-left text-sm text-ink transition-colors hover:bg-accent-soft/30 lg:min-h-11 lg:rounded-control lg:border-0 lg:bg-transparent lg:py-2.5 lg:text-muted-foreground lg:hover:text-ink"
    >
      <Bookmark className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1">Saved pieces</span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground lg:hidden"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </Link>
  );
}
