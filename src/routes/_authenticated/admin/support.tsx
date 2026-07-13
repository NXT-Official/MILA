import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataTable } from "@/components/ui/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSupportColumns } from "@/components/admin/support-columns";
import { queryKeys } from "@/constants/query-keys";
import { adminResolveSupportMessage } from "@/lib/admin.functions";
import { adminSupportQueryOptions } from "@/lib/queries/admin";
import { requireStaffRoutePermission } from "@/lib/staff-route";

export const Route = createFileRoute("/_authenticated/admin/support")({
  beforeLoad: ({ context }) => requireStaffRoutePermission(context.queryClient, "support.view"),
  component: SupportPage,
});

function SupportPage() {
  const qc = useQueryClient();
  const resolve = useServerFn(adminResolveSupportMessage);

  const { data, isLoading } = useQuery(adminSupportQueryOptions());

  async function toggleResolved(id: string, resolved: boolean) {
    try {
      await resolve({ data: { message_id: id, resolved } });
      qc.invalidateQueries({ queryKey: queryKeys.adminSupportMessages });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update message.");
    }
  }

  const rows = data ?? [];
  const helpRows = rows.filter((m) => m.kind === "help");
  const feedbackRows = rows.filter((m) => m.kind === "feedback");
  const columns = getSupportColumns({ onToggleResolved: toggleResolved });

  return (
    <Tabs defaultValue="help" className="w-full">
      <TabsList className="h-9">
        <TabsTrigger value="help" className="text-xs uppercase tracking-[0.18em]">
          Help Desk ({helpRows.length})
        </TabsTrigger>
        <TabsTrigger value="feedback" className="text-xs uppercase tracking-[0.18em]">
          Feedback ({feedbackRows.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="help" className="mt-6">
        <DataTable
          columns={columns}
          data={helpRows}
          isLoading={isLoading}
          searchable
          searchPlaceholder="Search help desk messages"
          searchText={(m) => m.message}
          countLabel="messages"
          emptyMessage="No help desk messages."
        />
      </TabsContent>
      <TabsContent value="feedback" className="mt-6">
        <DataTable
          columns={columns}
          data={feedbackRows}
          isLoading={isLoading}
          searchable
          searchPlaceholder="Search feedback"
          searchText={(m) => m.message}
          countLabel="messages"
          emptyMessage="No feedback yet."
        />
      </TabsContent>
    </Tabs>
  );
}
