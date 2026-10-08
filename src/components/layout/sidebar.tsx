import { Link } from "@tanstack/react-router";
import {
  LayoutGrid,
  Images,
  History as HistoryIcon,
  Palette,
  Bookmark,
  Sparkles,
  Camera,
  MessageCircle,
  ChevronsLeft,
  ChevronsRight,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AvatarInitial } from "@/components/ui/avatar-initial";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const primaryNavItems: { to: string; label: string; icon: typeof LayoutGrid }[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/feed", label: "Feed", icon: Images },
  { to: "/history", label: "History", icon: HistoryIcon },
  { to: "/palettes", label: "Palettes", icon: Palette },
  { to: "/saved", label: "Saved pieces", icon: Bookmark },
  { to: "/style-profile", label: "Studio", icon: Sparkles },
];

interface SidebarProps {
  path: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenLens: () => void;
  onOpenConcierge: () => void;
  credits: number | null | undefined;
  displayName: string;
}

function NavRow({
  active,
  expanded,
  icon: Icon,
  label,
  ...rest
}: {
  active: boolean;
  expanded: boolean;
  icon: typeof LayoutGrid;
  label: string;
} & ({ as: "link"; to: string } | { as: "button"; onClick: () => void; ariaLabel?: string })) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-pill bg-accent transition-opacity duration-200",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon className="size-4.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap text-sm transition-[max-width,opacity] duration-200 ease-editorial",
          expanded ? "max-w-40 opacity-100" : "max-w-0 opacity-0",
        )}
      >
        {label}
      </span>
    </>
  );

  const rowClass = cn(
    "atelier-focus-ring relative flex h-11 items-center gap-3 rounded-control px-3 transition-colors duration-200 ease-editorial",
    active
      ? "bg-accent-soft/60 text-accent"
      : "text-muted-foreground hover:bg-accent-soft/30 hover:text-ink",
  );

  if (rest.as === "link") {
    return (
      <Link to={rest.to} title={expanded ? undefined : label} className={rowClass}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={rest.onClick}
      title={expanded ? undefined : label}
      aria-label={rest.ariaLabel ?? label}
      className={rowClass}
    >
      {content}
    </button>
  );
}

export function Sidebar({
  path,
  expanded,
  onToggleExpanded,
  onOpenLens,
  onOpenConcierge,
  credits,
  displayName,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "hidden md:flex sticky top-0 h-screen shrink-0 flex-col border-r border-porcelain/30 bg-background/80 backdrop-blur-xl transition-[width] duration-200 ease-editorial",
        expanded ? "w-64" : "w-[4.5rem]",
      )}
    >
      <div className="flex h-16 items-center gap-2 px-4">
        <Link to="/dashboard" className="inline-flex items-center gap-2 shrink-0">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span
            className={cn(
              "overflow-hidden whitespace-nowrap font-serif text-xl uppercase tracking-label-xwide text-ink transition-[max-width,opacity] duration-200 ease-editorial",
              expanded ? "max-w-32 opacity-100" : "max-w-0 opacity-0",
            )}
          >
            Mila
          </span>
        </Link>
      </div>

      <nav className="flex flex-col gap-1 px-3 mt-2" aria-label="Main navigation">
        {primaryNavItems.map((item) => (
          <NavRow
            key={item.to}
            as="link"
            to={item.to}
            icon={item.icon}
            label={item.label}
            active={path === item.to}
            expanded={expanded}
          />
        ))}
      </nav>

      <div className="mt-4 px-3">
        <div
          className={cn(
            "px-3 pb-1.5 text-nano uppercase tracking-label text-muted-foreground/70 transition-opacity duration-200",
            expanded ? "opacity-100" : "opacity-0",
          )}
          aria-hidden={!expanded}
        >
          Quick actions
        </div>
        <div className="flex flex-col gap-1">
          <NavRow
            as="button"
            icon={Camera}
            label="Lens"
            active={false}
            expanded={expanded}
            onClick={onOpenLens}
          />
          <NavRow
            as="button"
            icon={MessageCircle}
            label="Concierge"
            active={path === "/concierge"}
            expanded={expanded}
            onClick={onOpenConcierge}
            ariaLabel="Open Mila's Styling Studio"
          />
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-3 border-t border-porcelain/30 p-3">
        <div className="flex items-center gap-2">
          {credits != null && (
            <Link
              to="/pricing"
              title={expanded ? undefined : `${credits} credits`}
              aria-label={`${credits} AI credits — view membership plans and credits`}
              className={cn(
                "atelier-focus-ring flex h-9 items-center gap-1.5 rounded-full border border-line/60 bg-canvas/60 px-3 text-micro uppercase tracking-label-wide text-ink backdrop-blur transition-colors hover:border-line",
                expanded ? "flex-1" : "",
              )}
            >
              <Coins
                className="size-3.5 text-accent shrink-0"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200",
                  expanded ? "max-w-20 opacity-100" : "max-w-0 opacity-0",
                )}
              >
                {credits} credits
              </span>
            </Link>
          )}
          {expanded && <ThemeToggle />}
        </div>

        <Link
          to="/account"
          aria-label="Your account"
          className="atelier-focus-ring flex items-center gap-2 rounded-control"
        >
          <AvatarInitial
            name={displayName}
            className="size-10 shrink-0 tracking-wide transition-all duration-300 hover:border-porcelain hover:shadow-atelier-soft"
          />
          <span
            className={cn(
              "overflow-hidden whitespace-nowrap text-sm text-ink transition-[max-width,opacity] duration-200 ease-editorial",
              expanded ? "max-w-32 opacity-100" : "max-w-0 opacity-0",
            )}
          >
            {displayName}
          </span>
        </Link>

        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-pressed={expanded}
          className="atelier-focus-ring flex h-9 w-full items-center justify-center gap-2 rounded-control text-muted-foreground hover:bg-accent-soft/30 hover:text-ink transition-colors"
        >
          {expanded ? (
            <ChevronsLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ChevronsRight className="size-4" strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>
    </aside>
  );
}
