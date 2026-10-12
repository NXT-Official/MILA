import { cn } from "@/lib/utils";
import { asWearColour, type WearColour } from "@/lib/wear-colour";

/**
 * Which of her colours to wear a piece in, over its product photo (Wave D,
 * R6). Same solid ink pill with surface text as GarmentBadge, so it reads on
 * any photo and flips with dark mode. The dot is her swatch, painted from the
 * validated hex only; it is decorative, because the colour's name is always
 * the visible text.
 */
export function WearColourChip({
  wear,
  className,
}: {
  wear: WearColour | null | undefined;
  className?: string;
}) {
  // Looks recovered from a stored job arrive unchecked: paint only a whole,
  // safe colour.
  const colour = asWearColour(wear);
  if (!colour) return null;
  return (
    <span
      className={cn(
        "pointer-events-none inline-flex max-w-full items-center gap-1.5 rounded-full bg-ink/90 px-2 py-1 text-micro font-medium uppercase tracking-label-tight text-surface",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full ring-1 ring-surface"
        style={{ backgroundColor: colour.hex }}
      />
      <span className="sr-only">Wear it in </span>
      <span className="truncate">{colour.name}</span>
    </span>
  );
}
