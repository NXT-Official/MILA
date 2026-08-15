import { Link } from "@tanstack/react-router";
import { Camera, LayoutGrid, Palette, Images, MessageCircle, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const topNavItems: { to: string; label: string; icon: typeof LayoutGrid }[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/feed", label: "Feed", icon: Images },
];

// Icons only, same set and order as the mobile bar. The name is the
// aria-label and the native tooltip, so nothing is lost to a hover-less device.
const navItem = "atelier-focus-ring rounded-control p-1.5 transition-colors";
const itemClass = (active: boolean) =>
  cn(navItem, active ? "text-accent" : "text-muted hover:text-ink");
const icon = "size-5";

export function DesktopNav({
  path,
  onOpenLens,
  onOpenConcierge,
}: {
  path: string;
  userId: string | undefined;
  onOpenLens: () => void;
  onOpenConcierge: () => void;
}) {
  return (
    <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex">
      {topNavItems.map((it) => {
        const Icon = it.icon;
        return (
          <Link
            key={it.to}
            to={it.to}
            aria-label={it.label}
            title={it.label}
            className={itemClass(path === it.to)}
          >
            <Icon className={icon} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onOpenLens}
        aria-label="Lens"
        title="Lens"
        className={itemClass(false)}
      >
        <Camera className={icon} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <Link
        to="/style-profile"
        aria-label="Studio"
        title="Studio"
        className={itemClass(path === "/style-profile")}
      >
        <Palette className={icon} strokeWidth={1.75} aria-hidden="true" />
      </Link>
      <Link
        to="/profile"
        aria-label="Profile"
        title="Profile"
        className={itemClass(path === "/profile")}
      >
        <UserRound className={icon} strokeWidth={1.75} aria-hidden="true" />
      </Link>
      <button
        type="button"
        onClick={onOpenConcierge}
        aria-label="Concierge"
        title="Concierge"
        className={itemClass(false)}
      >
        <MessageCircle className={icon} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </nav>
  );
}
