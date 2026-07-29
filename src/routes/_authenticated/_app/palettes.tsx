import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorPanel } from "@/components/ui/error-state";
import { queryKeys } from "@/constants/query-keys";
import {
  deleteSavedPalette,
  savedPalettesQueryOptions,
  type SavedPalette,
} from "@/lib/queries/saved-palettes";
import { errorMessage, relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/palettes")({
  component: SavedPalettes,
});

function PaletteCard({ row, onDelete }: { row: SavedPalette; onDelete: () => Promise<void> }) {
  const [deleting, setDeleting] = useState(false);
  const { palette } = row;
  const swatches = [
    { label: "Base Layer", name: palette.baseColor, hex: palette.baseHex },
    { label: "Statement", name: palette.statementColor, hex: palette.statementHex },
    { label: "Accent Pop", name: palette.accentColor, hex: palette.accentHex },
  ];

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center rounded-pill bg-accent-soft px-2.5 py-0.5 text-micro uppercase tracking-label text-accent">
          {palette.styleVibe}
        </span>
        <span className="atelier-label">{relativeTime(row.created_at)}</span>
      </div>

      <div className="mt-4 flex gap-2" aria-hidden="true">
        {swatches.map((s) => (
          <div
            key={s.label}
            className="h-16 flex-1 rounded-xl border border-border/40"
            style={{ backgroundColor: s.hex }}
          />
        ))}
      </div>

      <dl className="mt-4 space-y-1.5">
        {swatches.map((s) => (
          <div key={s.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-micro uppercase tracking-widest text-muted-foreground">
              {s.label}
            </dt>
            <dd className="text-sm font-medium text-foreground">{s.name}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto pt-5">
        <Button
          variant="outline"
          size="pill"
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            try {
              await onDelete();
            } finally {
              setDeleting(false);
            }
          }}
          className="w-full text-destructive border-destructive/40 hover:bg-destructive/10 text-xs hover:text-destructive"
        >
          {deleting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )}
          Remove
        </Button>
      </div>
    </Card>
  );
}

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
    <div className="atelier-page max-w-5xl">
      <PageHeader
        kicker="Colour"
        title="Saved palettes."
        description="Every daily mix you've pinned, ready to wear again."
      />

      {isLoading ? (
        <div
          role="status"
          aria-label="Loading saved palettes"
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="atelier-card h-72" />
          ))}
        </div>
      ) : isError ? (
        <LoadErrorPanel title="Couldn't load your palettes" onRetry={() => refetch()} />
      ) : !palettes?.length ? (
        <EmptyState
          role="status"
          className="mx-auto max-w-xl"
          icon={<Palette className="size-8" strokeWidth={1.25} />}
          title="No palettes saved yet"
          description="Tap the bookmark on your daily palette and it will be waiting here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {palettes.map((row) => (
            <PaletteCard key={row.id} row={row} onDelete={() => remove(row.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
