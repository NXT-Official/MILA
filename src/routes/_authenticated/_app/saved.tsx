import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { SavedPiecesView } from "@/components/saved/saved-pieces-view";
import {
  savedProductsQueryKey,
  removeTarget,
  savedProductsQueryOptions,
  unsaveProduct,
  type SavedProduct,
  type SavedProductsState,
} from "@/lib/queries/saved-products";
import { trackEvent } from "@/lib/track-event";

export const Route = createFileRoute("/_authenticated/_app/saved")({
  component: SavedPieces,
});

function SavedPieces() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    ...savedProductsQueryOptions(user?.id),
    enabled: !!user?.id,
  });

  async function remove(item: SavedProduct) {
    if (!user) return;
    const queryKey = savedProductsQueryKey(user.id);
    try {
      const result = await unsaveProduct(supabase, user.id, removeTarget(item));
      if (result === "unavailable") {
        queryClient.setQueryData<SavedProductsState>(queryKey, { status: "unavailable" });
        return;
      }
      if (result === "removed") {
        queryClient.setQueryData<SavedProductsState>(queryKey, (state) =>
          state?.status === "ready"
            ? { status: "ready", items: state.items.filter((i) => i.id !== item.id) }
            : state,
        );
        void trackEvent(supabase, user.id, "product_unsaved", {
          product_id: item.product_id,
          source: item.source,
        });
        toast.success("Removed from Saved pieces.");
      }
      // not_found: it was already gone (another tab or device); the refetch settles the list.
    } catch {
      toast.error("Couldn't remove that piece. Please try again.");
    } finally {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  return (
    <div className="atelier-page">
      <PageHeader
        kicker="Shop"
        title="Saved pieces."
        description="The pieces Mila recommended that you want to come back to."
      />
      <SavedPiecesView
        state={data}
        isLoading={!user || isLoading}
        isError={isError}
        onRetry={() => refetch()}
        onRemove={remove}
      />
    </div>
  );
}
