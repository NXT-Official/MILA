import { Link } from "@tanstack/react-router";
import { Camera, LayoutGrid, Palette, Images, MessageCircle, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

// Studio and Profile sit after the Lens button, so they stay out of this list —
// same order as the desktop nav.
const mobileTabItems: { to: string; label: string; icon: typeof LayoutGrid }[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/feed", label: "Feed", icon: Images },
];

// Icons only — six labels never fit ~50px each on a 360px screen. The name
// lives in aria-label/title instead of being truncated to nonsense.
const tab = "relative flex-1 min-w-0 flex items-center justify-center py-2.5 transition-colors";

export function MobileTabBar({
  path,
  onOpenLens,
  onOpenConcierge,
}: {
  path: string;
  onOpenLens: () => void;
  onOpenConcierge: () => void;
}) {
  return (
    <nav
      className="border border-white/10 bg-ink/90 text-surface shadow-nav backdrop-blur-xl md:hidden fixed left-3 right-3 z-50 flex items-center justify-around rounded-pill px-2.5 py-2.5"
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      {mobileTabItems.map((it) => {
        const active = path === it.to;
        const Icon = it.icon;

        return (
          <Link
            key={it.to}
            to={it.to}
            aria-label={it.label}
            title={it.label}
            className={cn(tab, active ? "text-accent" : "text-surface/50")}
          >
            <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onOpenLens}
        aria-label="Lens"
        title="Lens"
        className={cn(tab, "text-surface/50")}
      >
        <Camera className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      </button>
      <Link
        to="/style-profile"
        aria-label="Studio"
        title="Studio"
        className={cn(tab, path === "/style-profile" ? "text-accent" : "text-surface/50")}
      >
        <Palette className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      </Link>
      <Link
        to="/profile"
        aria-label="Profile"
        title="Profile"
        className={cn(tab, path === "/profile" ? "text-accent" : "text-surface/50")}
      >
        <UserRound className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      </Link>
      <button
        type="button"
        onClick={onOpenConcierge}
        aria-label="Concierge"
        title="Concierge"
        className={cn(tab, "text-surface/50")}
      >
        <MessageCircle className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </nav>
  );
}
