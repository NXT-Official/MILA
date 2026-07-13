import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const topNavItems: { to: string; label: string }[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/feed", label: "Feed" },
];

export function DesktopNav({
  path,
  onOpenLens,
  onOpenConcierge,
}: {
  path: string;
  onOpenLens: () => void;
  onOpenConcierge: () => void;
}) {
  return (
    <nav className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-10">
      {topNavItems.map((it) => {
        const active = path === it.to;
        return (
          <Link
            key={it.to}
            to={it.to}
            className={cn(
              "text-xs uppercase tracking-[0.2em] transition-colors",
              active ? "text-accent" : "text-muted hover:text-ink",
            )}
          >
            {it.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onOpenLens}
        className="text-xs uppercase tracking-[0.2em] text-muted hover:text-ink transition-colors"
      >
        Lens
      </button>
      <Link
        to="/style-profile"
        className={cn(
          "text-xs uppercase tracking-[0.2em] transition-colors",
          path === "/style-profile" ? "text-accent" : "text-muted hover:text-ink",
        )}
      >
        Studio
      </Link>
      <button
        type="button"
        onClick={onOpenConcierge}
        aria-label="Open Mila's Styling Studio"
        className="text-xs uppercase tracking-[0.2em] text-muted hover:text-ink transition-colors"
      >
        Concierge
      </button>
    </nav>
  );
}
