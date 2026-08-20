import { SEASON_HEX_MATRIX } from "@/constants/style-profile/data";

/**
 * The signature component (DESIGN.md §5): the one place a saturated, non-brand
 * colour is not merely allowed but required, because the swatch colour IS the
 * member's data. The name always ships alongside the swatches — a portion of
 * this audience cannot distinguish them at all, so colour never carries the
 * meaning on its own.
 *
 * Landing copy names seasons as "<Modifier> <Season>" ("True Summer"), which
 * maps onto the palette matrix keys ("SUMMER_TRUE").
 */
function paletteFor(season: string): string[] {
  const parts = season.trim().split(/\s+/);
  if (parts.length !== 2) return [];
  const palette = SEASON_HEX_MATRIX[`${parts[1].toUpperCase()}_${parts[0].toUpperCase()}`];
  if (!palette?.length) return [];
  // Three stops spread across the twenty, so the chip shows range, not one hue.
  return [0, 6, 13].map((i) => palette[i % palette.length]);
}

export function SeasonTag({ season }: { season: string }) {
  const stops = paletteFor(season);

  return (
    <span className="inline-flex items-center gap-2 rounded-pill border border-border py-1 pl-1.5 pr-2.5 text-label font-semibold uppercase tracking-label text-ink">
      {stops.length > 0 ? (
        <span
          aria-hidden="true"
          className="flex h-2.5 w-8 shrink-0 overflow-hidden rounded-pill ring-1 ring-inset ring-ink/20"
        >
          {stops.map((hex, i) => (
            <span key={i} className="flex-1" style={{ backgroundColor: hex }} />
          ))}
        </span>
      ) : null}
      {season}
    </span>
  );
}
