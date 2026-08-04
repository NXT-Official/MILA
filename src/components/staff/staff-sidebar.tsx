import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  ShieldAlert,
  LifeBuoy,
  CreditCard,
  LogOut,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useSignOut } from "@/hooks/use-sign-out";
import {
  hasPermission,
  staffBase,
  STAFF_ROUTE_PERMISSIONS,
  type AppPermission,
  type AppRole,
} from "@/lib/authorization";

interface StaffNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: AppPermission;
}

// Both trees are listed; the filter below keeps only the viewer's own tree, so an
// admin gets /admin/moderation and a moderator gets /moderator/moderation.
const STAFF_LINKS: StaffNavItem[] = [
  {
    to: "/admin",
    label: "Dashboard",
    icon: LayoutDashboard,
    permission: STAFF_ROUTE_PERMISSIONS["/admin"],
  },
  {
    to: "/admin/members",
    label: "Members",
    icon: Users,
    permission: STAFF_ROUTE_PERMISSIONS["/admin/members"],
  },
  {
    to: "/admin/subscription-plans",
    label: "Plans",
    icon: CreditCard,
    permission: STAFF_ROUTE_PERMISSIONS["/admin/subscription-plans"],
  },
  {
    to: "/admin/moderation",
    label: "Moderation",
    icon: ShieldAlert,
    permission: STAFF_ROUTE_PERMISSIONS["/admin/moderation"],
  },
  {
    to: "/admin/support",
    label: "Support",
    icon: LifeBuoy,
    permission: STAFF_ROUTE_PERMISSIONS["/admin/support"],
  },
  {
    to: "/moderator/moderation",
    label: "Moderation",
    icon: ShieldAlert,
    permission: STAFF_ROUTE_PERMISSIONS["/moderator/moderation"],
  },
  {
    to: "/moderator/support",
    label: "Support",
    icon: LifeBuoy,
    permission: STAFF_ROUTE_PERMISSIONS["/moderator/support"],
  },
];

export function StaffSidebar({
  path,
  roles,
  onNavigate,
}: {
  path: string;
  roles: AppRole[];
  onNavigate?: () => void;
}) {
  const { user } = useAuth();
  const { signingOut, handleSignOut } = useSignOut();

  const initial = (user?.email?.[0] ?? "M").toUpperCase();
  const base = staffBase(roles);
  const links = STAFF_LINKS.filter(
    ({ to, permission }) => to.startsWith(base) && hasPermission(roles, permission),
  );

  return (
    <div className="flex h-full w-76 shrink-0 flex-col border-r border-porcelain/60 bg-atelier-panel/30 px-5 py-6">
      <div className="mb-8 px-1">
        <div className="text-nano uppercase tracking-label-xwide text-stone">Atelier</div>
        <div className="mt-1 font-serif text-xl tracking-label-tight uppercase text-ink">
          {roles.includes("admin") ? "Admin Suite" : "Moderation Suite"}
        </div>
      </div>

      <nav className="flex flex-col gap-1.5" aria-label="Staff sections">
        {links.map(({ to, label, icon: Icon }) => {
          const active = path === to;
          return (
            <Link
              key={to}
              to={to}
              onClick={() => onNavigate?.()}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-full px-4 py-2.5 text-xs uppercase tracking-label-wide transition-colors",
                active
                  ? "bg-ink text-background"
                  : "text-stone hover:text-ink hover:bg-background/60",
              )}
            >
              <Icon className="size-4.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-porcelain/60 pt-4">
        <div className="flex items-center gap-2.5 px-1 py-1">
          <div className="size-8 shrink-0 rounded-full border border-porcelain/60 bg-atelier-panel flex items-center justify-center font-serif text-xs text-ink">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="text-xs text-ink truncate">{user?.email ?? "Steward"}</div>
            <div className="text-nano uppercase tracking-label text-stone">
              {roles.includes("admin") ? "Steward" : "Moderator"}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="Sign out"
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-porcelain/60 px-4 py-2 atelier-label transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-50"
        >
          {signingOut ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <LogOut className="size-3.5" strokeWidth={1.75} />
          )}
          Sign Out
        </button>
      </div>
    </div>
  );
}
