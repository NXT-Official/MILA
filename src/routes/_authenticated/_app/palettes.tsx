import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { PaletteCard, PalettesEmptyState } from "@/components/palettes/palette-card";
import { LoadErrorPanel } from "@/components/ui/error-state";
import { queryKeys } from "@/constants/query-keys";
import { deleteSavedPalette, savedPalettesQueryOptions } from "@/lib/queries/saved-palettes";
import { errorMessage } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/palettes")({
  component: SavedPalettes,
});

function SavedPalettes() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const {
    data: palettes,
    isLoading,
    isError,
    refetch,
  } = useQuery({ ...savedPalettesQueryOptions(user?.id), enabled: !!user?.id });

  async function remove(id: string) {
    if (!user) return;
    try {
      await deleteSavedPalette(user.id, id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.savedPalettes(user.id) });
      toast.success("Palette removed.");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't remove that palette."));
    }
  }

  return (
    <div className="atelier-page">
      <PageHeader
        kicker="Colour"
        title="Saved palettes."
        description="Every daily mix you've pinned, ready to wear again."
      />

      {isLoading ? (
        <div
          role="status"
          aria-label="Loading saved palettes"
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="atelier-card h-72" />
          ))}
        </div>
      ) : isError ? (
        <LoadErrorPanel title="Couldn't load your palettes" onRetry={() => refetch()} />
      ) : !palettes?.length ? (
        <PalettesEmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
          {palettes.map((row) => (
            <PaletteCard key={row.id} row={row} onDelete={() => remove(row.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
