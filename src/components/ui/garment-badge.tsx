import { cn } from "@/lib/utils";
import { garmentGlyph } from "@/lib/garment-glyphs";
import type { Garment } from "@/lib/garment-label";

/**
 * Names the piece Mila is recommending, over a product photo that may show a
 * whole outfit. Bottom-left of the image: top-left is the discount badge and
 * top-right the Save button. Solid ink pill with surface text, so it reads on
 * any photo and flips correctly in dark mode (both tokens invert together).
 */
export function GarmentBadge({ garment, className }: { garment: Garment; className?: string }) {
  const Glyph = garmentGlyph(garment);
  return (
    <span
      className={cn(
        "pointer-events-none absolute bottom-2 left-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-ink/90 px-2 py-1 text-micro font-medium uppercase tracking-label-tight text-surface",
        className,
      )}
    >
      <Glyph className="size-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="truncate">{garment.label}</span>
    </span>
  );
}
