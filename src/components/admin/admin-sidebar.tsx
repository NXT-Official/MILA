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
  STAFF_ROUTE_PERMISSIONS,
  type AppPermission,
  type AppRole,
} from "@/lib/authorization";

interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: AppPermission;
}

const ADMIN_LINKS: AdminNavItem[] = [
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
];

export function AdminSidebar({
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

  return (
    <div className="flex h-full w-76 shrink-0 flex-col border-r border-porcelain/60 bg-atelier-panel/30 px-5 py-6">
      <div className="mb-8 px-1">
        <div className="text-[9px] uppercase tracking-[0.28em] text-stone">Atelier</div>
        <div className="mt-1 font-serif text-xl tracking-[0.14em] uppercase text-ink">
          Admin Suite
        </div>
      </div>

      <nav className="flex flex-col gap-1.5" aria-label="Admin sections">
        {ADMIN_LINKS.filter(({ permission }) => hasPermission(roles, permission)).map(
          ({ to, label, icon: Icon }) => {
            const active = path === to;
            return (
              <Link
                key={to}
                to={to}
                onClick={() => onNavigate?.()}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-full px-4 py-2.5 text-[10px] uppercase tracking-[0.22em] transition-colors",
                  active
                    ? "bg-ink text-background"
                    : "text-stone hover:text-ink hover:bg-background/60",
                )}
              >
                <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
                {label}
              </Link>
            );
          },
        )}
      </nav>

      <div className="mt-auto border-t border-porcelain/50 pt-4">
        <div className="flex items-center gap-2.5 px-1 py-1">
          <div className="size-8 shrink-0 rounded-full border border-porcelain/60 bg-atelier-panel flex items-center justify-center font-serif text-xs text-ink">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="text-xs text-ink truncate">{user?.email ?? "Steward"}</div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-stone">
              {roles.includes("admin") ? "Steward" : "Moderator"}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="Sign out"
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-porcelain/60 px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-stone transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-50"
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
