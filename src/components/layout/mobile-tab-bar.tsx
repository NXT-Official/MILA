import { Link } from "@tanstack/react-router";
import { Camera, LayoutGrid, Palette, Images, MessageCircle, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

// Studio and Profile sit after the Lens button, so they stay out of this list —
// same order as the desktop nav.
const mobileTabItems: { to: string; label: string; icon: typeof LayoutGrid }[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/feed", label: "Feed", icon: Images },
];

// min-w-0 + truncate: six tabs leave ~50px each on a 360px screen, and
// "Dashboard"/"Concierge" are wider than that unaided.
const tab =
  "relative flex-1 min-w-0 flex flex-col items-center gap-0.5 py-1.5 text-[9px] uppercase tracking-label transition-colors";
const label = "max-w-full truncate";

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
            className={cn(tab, active ? "text-accent" : "text-surface/50")}
          >
            <Icon className="size-4.5 shrink-0" strokeWidth={1.75} />
            <span className={label}>{it.label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={onOpenLens} className={cn(tab, "text-surface/50")}>
        <Camera className="size-4.5 shrink-0" strokeWidth={1.75} />
        <span className={label}>Lens</span>
      </button>
      <Link
        to="/style-profile"
        className={cn(tab, path === "/style-profile" ? "text-accent" : "text-surface/50")}
      >
        <Palette className="size-4.5 shrink-0" strokeWidth={1.75} />
        <span className={label}>Studio</span>
      </Link>
      <Link
        to="/profile"
        className={cn(tab, path === "/profile" ? "text-accent" : "text-surface/50")}
      >
        <UserRound className="size-4.5 shrink-0" strokeWidth={1.75} />
        <span className={label}>Profile</span>
      </Link>
      <button
        type="button"
        onClick={onOpenConcierge}
        aria-label="Open Mila's Concierge"
        className={cn(tab, "text-surface/50")}
      >
        <MessageCircle className="size-4.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className={label}>Concierge</span>
      </button>
    </nav>
  );
}
