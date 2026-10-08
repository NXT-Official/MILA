import { LookSection } from "@/components/dashboard/look-section";
import { scrollToShopCard, shopCardId } from "@/lib/shop-card-scroll";
import type { GarmentKind } from "@/lib/garment-label";
import {
  asWearColour,
  defaultRoleFor,
  type ColourMapRow,
  type SavedColourMapRow,
  type WearRole,
} from "@/lib/wear-colour";

/**
 * A row as the panel reads it: a look's own rows (colourMapRows) carry the
 * card id and the reason; a saved look's compact rows (toSavedColourMap, D-W8)
 * do not.
 */
export type ColourMapPanelRow = SavedColourMapRow & Partial<Pick<ColourMapRow, "id" | "reason">>;

const ROLE_NAMES: Readonly<Record<WearRole, string>> = {
  base: "Base",
  statement: "Statement",
  accent: "Accent",
};

const ROLE_PLACES: Readonly<Record<WearRole, string>> = {
  base: "Bottoms and outer layers",
  statement: "Near your face",
  accent: "Shoes, bag and jewelry",
};

/**
 * The role words under a colour. The place ("Near your face") is shown only
 * when the role is where this kind of piece sits on the wear map; a role the
 * model gave against the map (a statement shoe) shows its name alone, so the
 * words never contradict the piece.
 */
function roleWords(role: WearRole, kind: GarmentKind): string {
  return role === defaultRoleFor(kind)
    ? `${ROLE_NAMES[role]} · ${ROLE_PLACES[role]}`
    : ROLE_NAMES[role];
}

/**
 * "Your color map" (Wave D, R6): which of her own colours to wear each piece
 * of the look in, its role and why. The swatch is her colour as data, never
 * the only signal: the colour's name and its role are always written out.
 * A look from before colour maps (or with no colour picked at all) says so
 * plainly instead of showing an empty map.
 */
export function ColourMapPanel({
  rows,
  linkToCards,
}: {
  rows: readonly ColourMapPanelRow[];
  /** True beside the look's own Shop cards: each row links to its card. */
  linkToCards: boolean;
}) {
  // Rows from a stored job or a saved look arrive unchecked: only a whole,
  // safe colour is painted.
  const checked = rows.map((row) => ({ ...row, wear: asWearColour(row.wear) }));
  const hasColours = checked.some((row) => row.wear !== null);

  if (!hasColours) {
    return (
      <LookSection kicker="Your color map">
        <p className="text-sm text-muted-foreground">
          This look has no color map. Looks made after your color read include one.
        </p>
      </LookSection>
    );
  }

  return (
    <LookSection kicker="Your color map">
      <p className="text-sm text-muted-foreground">Wear each piece in one of your colors.</p>
      <ul
        aria-label="Your color map"
        className="mt-5 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2"
      >
        {checked.map((row, index) => (
          <li key={row.id || `${row.kind}-${index}`} className="flex items-start gap-3">
            {row.wear ? (
              <span
                aria-hidden="true"
                className="mt-0.5 size-9 shrink-0 rounded-full border border-ink/15"
                style={{ backgroundColor: row.wear.hex }}
              />
            ) : (
              <span
                aria-hidden="true"
                className="mt-0.5 size-9 shrink-0 rounded-full border border-dashed border-muted-foreground/60"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-label-tight text-ink">
                {row.label}
              </p>
              {row.wear ? (
                <>
                  <p className="font-serif text-base leading-snug text-ink [overflow-wrap:anywhere]">
                    {row.wear.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {roleWords(row.wear.role, row.kind)}
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  No color picked for this piece.
                </p>
              )}
              {row.reason ? (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">
                  {row.reason}
                </p>
              ) : null}
              {linkToCards && row.id ? (
                <a
                  href={`#${shopCardId(row.id)}`}
                  // The visible words come first, so the name holds them (label
                  // in name); a hidden span here read "See this piece :" in Chrome.
                  aria-label={`See this piece: ${row.title}`}
                  onClick={(event) => {
                    if (row.id && scrollToShopCard(row.id)) event.preventDefault();
                  }}
                  className="atelier-focus-ring -ml-1 inline-flex min-h-11 items-center rounded-control px-1 text-xs font-semibold uppercase tracking-label-tight text-ink underline-offset-4 hover:underline"
                >
                  See this piece
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-5 border-t border-border/70 pt-4 text-xs leading-relaxed text-muted-foreground">
        Shop links are pieces to wear in these colors. A piece may come in other colorways, so
        choose the one closest to your color.
      </p>
    </LookSection>
  );
}
