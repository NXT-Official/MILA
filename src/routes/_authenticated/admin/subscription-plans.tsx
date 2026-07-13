import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { getSubscriptionPlanColumns } from "@/components/admin/subscription-plan-columns";
import { SubscriptionPlanFormDialog } from "@/components/admin/subscription-plan-form-dialog";
import { queryKeys } from "@/constants/query-keys";
import { adminSubscriptionPlansQueryOptions } from "@/lib/queries/subscription-plans";
import {
  adminDeleteSubscriptionPlan,
  adminReorderSubscriptionPlans,
  adminSetSubscriptionPlanArchived,
  adminUpdateSubscriptionPlan,
} from "@/lib/subscription-plans.functions";
import type { SubscriptionPlan } from "@/lib/subscription-plans";
import { requireStaffRoutePermission } from "@/lib/staff-route";

export const Route = createFileRoute("/_authenticated/admin/subscription-plans")({
  beforeLoad: ({ context }) =>
    requireStaffRoutePermission(context.queryClient, "subscriptionPlans.manage"),
  component: SubscriptionPlansPage,
});

function SubscriptionPlansPage() {
  const qc = useQueryClient();
  const updatePlan = useServerFn(adminUpdateSubscriptionPlan);
  const setArchived = useServerFn(adminSetSubscriptionPlanArchived);
  const deletePlan = useServerFn(adminDeleteSubscriptionPlan);
  const reorderPlans = useServerFn(adminReorderSubscriptionPlans);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | undefined>(undefined);

  const { data, isLoading, isError, refetch } = useQuery(adminSubscriptionPlansQueryOptions());
  const plans = data ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: queryKeys.adminSubscriptionPlans });
    qc.invalidateQueries({ queryKey: queryKeys.subscriptionPlans });
  }

  async function run(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action();
      toast.success(successMessage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the plan.");
    } finally {
      invalidate();
    }
  }

  function openCreate() {
    setEditingPlan(undefined);
    setFormOpen(true);
  }

  function openEdit(plan: SubscriptionPlan) {
    setEditingPlan(plan);
    setFormOpen(true);
  }

  const columns = getSubscriptionPlanColumns({
    onEdit: openEdit,
    onToggleActive: (plan, active) =>
      run(
        () => updatePlan({ data: { id: plan.id, is_active: active } }),
        active ? `“${plan.title}” is now public.` : `“${plan.title}” is now hidden.`,
      ),
    onToggleFeatured: (plan, featured) =>
      run(
        () => updatePlan({ data: { id: plan.id, is_featured: featured } }),
        featured ? `“${plan.title}” is now featured.` : `“${plan.title}” is no longer featured.`,
      ),
    onMove: (plan, direction) => {
      const index = plans.findIndex((p) => p.id === plan.id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= plans.length) return;
      const ids = plans.map((p) => p.id);
      [ids[index], ids[target]] = [ids[target], ids[index]];
      void run(() => reorderPlans({ data: { plan_ids: ids } }), "Order updated.");
    },
    onArchive: (plan, archived) =>
      run(
        () => setArchived({ data: { id: plan.id, archived } }),
        archived ? `“${plan.title}” archived.` : `“${plan.title}” restored (still inactive).`,
      ),
    onDelete: (plan) => {
      if (
        !window.confirm(
          `Delete “${plan.title}” permanently? This cannot be undone.\n\nPrefer archiving if this plan may ever be referenced by a purchase.`,
        )
      ) {
        return;
      }
      void run(() => deletePlan({ data: { id: plan.id } }), "Plan deleted.");
    },
  });

  if (isError) {
    return (
      <div className="rounded-panel border border-porcelain/60 bg-atelier-panel/40 px-6 py-14 text-center">
        <p className="font-serif text-lg text-ink">Couldn't load subscription plans</p>
        <p className="mt-1 text-sm text-stone">Check your connection and try again.</p>
        <Button size="sm" variant="outline" className="mt-5" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      <DataTable
        columns={columns}
        data={plans}
        isLoading={isLoading}
        searchable
        searchPlaceholder="Search by title or slug"
        searchText={(p) => `${p.title} ${p.slug}`}
        countLabel="plans"
        emptyMessage="No subscription plans yet. Create the first one."
        action={
          <Button size="sm" className="h-9 text-xs gap-1.5" onClick={openCreate}>
            <Plus className="size-3.5" />
            Create Plan
          </Button>
        }
      />

      <SubscriptionPlanFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        plan={editingPlan}
        nextSortOrder={plans.length ? Math.max(...plans.map((p) => p.sort_order)) + 1 : 0}
        onSaved={invalidate}
      />
    </div>
  );
}
