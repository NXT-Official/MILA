import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Palette, Trash2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { SavedPalette } from "@/lib/queries/saved-palettes";
import { relativeTime } from "@/lib/utils";
import { WEAR_LINES } from "@/lib/color-analysis/daily-palette";

export function PaletteCard({
  row,
  onDelete,
}: {
  row: SavedPalette;
  onDelete: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const { palette } = row;
  const swatches = [
    { label: "Base", wear: WEAR_LINES.base, name: palette.baseColor, hex: palette.baseHex },
    {
      label: "Statement",
      wear: WEAR_LINES.statement,
      name: palette.statementColor,
      hex: palette.statementHex,
    },
    { label: "Accent", wear: WEAR_LINES.accent, name: palette.accentColor, hex: palette.accentHex },
  ];

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center rounded-pill bg-accent-soft px-2.5 py-0.5 text-micro uppercase tracking-label text-ink">
          {palette.styleVibe}
        </span>
        <span className="atelier-label">{relativeTime(row.created_at)}</span>
      </div>

      <div className="mt-4 flex gap-2" aria-hidden="true">
        {swatches.map((s) => (
          <div
            key={s.label}
            className="h-16 flex-1 rounded-control border border-border/40"
            style={{ backgroundColor: s.hex }}
          />
        ))}
      </div>

      <dl className="mt-4 space-y-1.5">
        {swatches.map((s) => (
          <div key={s.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-micro uppercase tracking-widest text-muted-foreground">
              {s.label}
              <span className="block normal-case tracking-normal">{s.wear}</span>
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

export function PalettesEmptyState() {
  return (
    <EmptyState
      role="status"
      className="mx-auto max-w-xl"
      icon={<Palette className="size-8" strokeWidth={1.25} />}
      title="No palettes saved yet"
      description="Tap the bookmark on your daily palette and it will be waiting here."
      action={
        <Button asChild>
          <Link to="/dashboard">Make today&apos;s palette</Link>
        </Button>
      }
    />
  );
}
