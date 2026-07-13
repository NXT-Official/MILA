import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, ShieldCheck, Coins, Images, EyeOff, LifeBuoy, Loader2, Inbox } from "lucide-react";
import { adminDashboardQueryOptions } from "@/lib/queries/admin";
import { AdminStatCard } from "@/components/admin/admin-stat-card";
import { requireStaffRoutePermission } from "@/lib/staff-route";

export const Route = createFileRoute("/_authenticated/admin/")({
  beforeLoad: ({ context }) =>
    requireStaffRoutePermission(context.queryClient, "admin.dashboard.view"),
  component: AdminDashboard,
});

function AdminDashboard() {
  const { data: stats, isLoading } = useQuery(adminDashboardQueryOptions());

  if (isLoading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-stone">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <AdminStatCard icon={Users} label="Total Members" value={stats?.totalMembers ?? 0} />
        <AdminStatCard icon={ShieldCheck} label="Stewards" value={stats?.totalStewards ?? 0} />
        <AdminStatCard
          icon={Coins}
          label="AI Credits Available"
          value={stats?.aiCreditsAvailable ?? 0}
          sublabel="Current balance across members"
        />
        <AdminStatCard icon={Images} label="Feed Posts" value={stats?.totalPosts ?? 0} />
        <AdminStatCard
          icon={EyeOff}
          label="Hidden Posts"
          value={stats?.hiddenPosts ?? 0}
          sublabel="Moderation actions taken"
        />
        <AdminStatCard
          icon={LifeBuoy}
          label="Open Support Messages"
          value={stats?.openSupportMessages ?? 0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <h2 className="text-[10px] uppercase tracking-[0.22em] text-stone mb-4">
            Recent Members
          </h2>
          <div className="rounded-panel border border-porcelain/60 bg-atelier-panel/40 overflow-hidden">
            {(stats?.recentMembers ?? []).map((m) => (
              <div
                key={m.id}
                className="px-5 py-3 border-b border-porcelain/30 last:border-0 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-serif text-sm text-ink truncate">
                    {m.full_name || m.username || "Unnamed"}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-stone">
                    {m.username ? `@${m.username}` : "—"}
                  </div>
                </div>
                <div className="text-[10px] text-stone shrink-0">
                  {new Date(m.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
            {stats?.recentMembers.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-sm text-stone">
                <Users className="size-5 text-muted" strokeWidth={1.75} aria-hidden="true" />
                No members yet.
              </div>
            )}
          </div>
          <Link
            to="/admin/members"
            className="mt-3 inline-block text-[10px] uppercase tracking-[0.22em] text-stone hover:text-ink"
          >
            View all members →
          </Link>
        </section>

        <section>
          <h2 className="text-[10px] uppercase tracking-[0.22em] text-stone mb-4">
            Recent Activity
          </h2>
          <div className="rounded-panel border border-porcelain/60 bg-atelier-panel/40 overflow-hidden">
            {(stats?.recentPosts ?? []).map((p) => (
              <div
                key={p.id}
                className="px-5 py-3 border-b border-porcelain/30 last:border-0 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-serif text-sm text-ink truncate">
                    {p.author_name || "Unnamed"}
                    {p.hidden && (
                      <span className="ml-2 text-[9px] uppercase tracking-[0.18em] text-destructive">
                        Hidden
                      </span>
                    )}
                  </div>
                  {p.caption && (
                    <div className="text-xs text-stone truncate max-w-xs">{p.caption}</div>
                  )}
                </div>
                <div className="text-[10px] text-stone shrink-0">
                  {new Date(p.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
            {stats?.recentPosts.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-sm text-stone">
                <Inbox className="size-5 text-muted" strokeWidth={1.75} aria-hidden="true" />
                No activity yet.
              </div>
            )}
          </div>
          <Link
            to="/admin/moderation"
            className="mt-3 inline-block text-[10px] uppercase tracking-[0.22em] text-stone hover:text-ink"
          >
            View moderation →
          </Link>
        </section>
      </div>
    </div>
  );
}
