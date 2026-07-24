import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { getCreditPackColumns } from "@/components/admin/credit-pack-columns";
import { CreditPackFormDialog } from "@/components/admin/credit-pack-form-dialog";
import { queryKeys } from "@/constants/query-keys";
import { adminCreditPacksQueryOptions } from "@/lib/queries/credit-packs";
import {
  adminDeleteCreditPack,
  adminSetCreditPackArchived,
  adminUpdateCreditPack,
} from "@/lib/credit-packs.functions";
import type { CreditPack } from "@/lib/credit-packs";
import { requireStaffRoutePermission } from "@/lib/staff-route";

export const Route = createFileRoute("/_authenticated/admin/credit-packs")({
  beforeLoad: ({ context }) =>
    requireStaffRoutePermission(context.queryClient, "subscriptionPlans.manage"),
  component: CreditPacksPage,
});

function CreditPacksPage() {
  const qc = useQueryClient();
  const updatePack = useServerFn(adminUpdateCreditPack);
  const setArchived = useServerFn(adminSetCreditPackArchived);
  const deletePack = useServerFn(adminDeleteCreditPack);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<CreditPack | undefined>(undefined);

  const { data, isLoading, isError, refetch } = useQuery(adminCreditPacksQueryOptions());
  const packs = data ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: queryKeys.adminCreditPacks });
    qc.invalidateQueries({ queryKey: queryKeys.creditPacks });
  }

  async function run(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action();
      toast.success(successMessage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the pack.");
    } finally {
      invalidate();
    }
  }

  function openCreate() {
    setEditingPack(undefined);
    setFormOpen(true);
  }

  function openEdit(pack: CreditPack) {
    setEditingPack(pack);
    setFormOpen(true);
  }

  const columns = getCreditPackColumns({
    onEdit: openEdit,
    onToggleActive: (pack, active) =>
      run(
        () => updatePack({ data: { id: pack.id, is_active: active } }),
        active ? `“${pack.title}” is now public.` : `“${pack.title}” is now hidden.`,
      ),
    onArchive: (pack, archived) =>
      run(
        () => setArchived({ data: { id: pack.id, archived } }),
        archived ? `“${pack.title}” archived.` : `“${pack.title}” restored (still inactive).`,
      ),
    onDelete: (pack) => {
      if (
        !window.confirm(
          `Delete “${pack.title}” permanently? This cannot be undone.\n\nPrefer archiving if this pack may ever be referenced by a purchase.`,
        )
      ) {
        return;
      }
      void run(() => deletePack({ data: { id: pack.id } }), "Pack deleted.");
    },
  });

  if (isError) {
    return (
      <div className="rounded-panel border border-porcelain/60 bg-atelier-panel/40 px-6 py-14 text-center">
        <p className="font-serif text-lg text-ink">Couldn't load credit packs</p>
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
        data={packs}
        isLoading={isLoading}
        searchable
        searchPlaceholder="Search by title or slug"
        searchText={(p) => `${p.title} ${p.slug}`}
        countLabel="packs"
        emptyMessage="No credit packs yet. Create the first one."
        action={
          <Button size="sm" className="h-9 text-xs gap-1.5" onClick={openCreate}>
            <Plus className="size-3.5" />
            Create Pack
          </Button>
        }
      />

      <CreditPackFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        pack={editingPack}
        nextSortOrder={packs.length ? Math.max(...packs.map((p) => p.sort_order)) + 1 : 0}
        onSaved={invalidate}
      />
    </div>
  );
}
