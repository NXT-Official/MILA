import { Link } from "@tanstack/react-router";
import type { AuthenticatedDestination } from "@/lib/queries/auth";
import { cn } from "@/lib/utils";

const topNavItems: { to: string; label: string }[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/feed", label: "Feed" },
];

const navItem = "text-xs uppercase tracking-label transition-colors";
const itemClass = (active: boolean) =>
  cn(navItem, active ? "text-accent" : "text-muted hover:text-ink");

export function DesktopNav({
  path,
  userId,
  staff,
  onOpenLens,
  onOpenConcierge,
}: {
  path: string;
  userId: string | undefined;
  staff: { to: AuthenticatedDestination; label: string } | null;
  onOpenLens: () => void;
  onOpenConcierge: () => void;
}) {
  return (
    <nav className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-10">
      {topNavItems.map((it) => (
        <Link key={it.to} to={it.to} className={itemClass(path === it.to)}>
          {it.label}
        </Link>
      ))}
      <button type="button" onClick={onOpenLens} className={itemClass(false)}>
        Lens
      </button>
      <Link to="/style-profile" className={itemClass(path === "/style-profile")}>
        Studio
      </Link>
      {userId && (
        <Link
          to="/profile/$userId"
          params={{ userId }}
          className={itemClass(path === `/profile/${userId}`)}
        >
          Profile
        </Link>
      )}
      <button
        type="button"
        onClick={onOpenConcierge}
        aria-label="Open Mila's Styling Studio"
        className={itemClass(false)}
      >
        Concierge
      </button>
      {staff && (
        <Link to={staff.to} className={itemClass(false)}>
          {staff.label}
        </Link>
      )}
    </nav>
  );
}
