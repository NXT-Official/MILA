import { Link } from "@tanstack/react-router";
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
  onOpenLens,
  onOpenConcierge,
}: {
  path: string;
  userId: string | undefined;
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
      <Link to="/profile" className={itemClass(path === "/profile")}>
        Profile
      </Link>
      <button
        type="button"
        onClick={onOpenConcierge}
        aria-label="Open Mila's Concierge"
        className={itemClass(false)}
      >
        Concierge
      </button>
    </nav>
  );
}
