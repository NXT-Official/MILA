import { GarmentBadge } from "@/components/ui/garment-badge";
import { WearColourChip } from "@/components/ui/wear-colour-chip";
import type { Garment } from "@/lib/garment-label";
import type { WearColour } from "@/lib/wear-colour";

/**
 * Bottom-left of a recommended product's photo: the garment badge, then the
 * colour chip naming which of her colours to wear it in (Wave D, R6). The
 * badge keeps its own look and simply flows here instead of floating alone
 * (`static` wins over its `absolute` through cn's tailwind-merge); top-left
 * stays the discount badge and top-right the Save button. Wraps onto a second
 * line on a narrow card rather than covering the photo.
 */
export function GarmentOverlay({ garment, wear }: { garment: Garment; wear?: WearColour | null }) {
  return (
    <span className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1">
      <GarmentBadge garment={garment} className="static max-w-full" />
      <WearColourChip wear={wear} />
    </span>
  );
}
