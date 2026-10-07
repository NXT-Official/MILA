import type { ShoppablePick } from "@/lib/generate-outfit.functions";

/** https/http only — saved links are rendered as hrefs in History, so a
 * persisted row must never carry a `javascript:`/`data:` URL. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const MAX_SAVED_PICKS = 40;

/**
 * The write-side guard for a saved look's shoppable picks (defense in depth
 * on top of the handler's zod caps — the row shape is client-supplied). A
 * pick whose affiliate link is not http(s) is dropped: the link is the whole
 * point of saving the item. A non-http image is nulled rather than persisted
 * into History's `<img>` src. `undefined`/`null` in stays `undefined` out, so
 * a look saved without picks keeps the key absent — History then hides the
 * section exactly like the dashboard does for the same look.
 */
export function sanitizePicksForSave(
  picks: ShoppablePick[] | null | undefined,
): ShoppablePick[] | undefined {
  if (!picks) return undefined;
  return picks
    .filter((pick) => isHttpUrl(pick.affiliate_link))
    .slice(0, MAX_SAVED_PICKS)
    .map((pick) => ({
      ...pick,
      image_url: pick.image_url && isHttpUrl(pick.image_url) ? pick.image_url : null,
    }));
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** One stored pick, tolerated field-by-field: a row damaged after the fact
 * loses the pick, never throws halfway down History. */
function toPick(value: unknown): ShoppablePick | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = str(record.id);
  const title = str(record.title);
  const link = str(record.affiliate_link);
  if (!id || !title || !isHttpUrl(link)) return null;
  const image = str(record.image_url);
  const source =
    record.source === "similar"
      ? ("similar" as const)
      : record.source === "planned"
        ? ("planned" as const)
        : undefined;
  return {
    id,
    title,
    brand_id: str(record.brand_id),
    category: str(record.category),
    price: typeof record.price === "number" ? record.price : 0,
    currency: str(record.currency) || "USD",
    image_url: image && isHttpUrl(image) ? image : null,
    affiliate_link: link,
    verification_status: str(record.verification_status),
    last_verified_at: typeof record.last_verified_at === "string" ? record.last_verified_at : null,
    rationale: str(record.rationale),
    ...(source ? { source } : {}),
  };
}

/**
 * The read-side normalizer for a saved look's picks. An array present in the
 * row (even empty) renders: empty shows the grid's own "no verified item"
 * copy, the same as a freshly generated look with no picks. Absent or not an
 * array — every row saved before the field existed — returns `undefined` and
 * History keeps the section hidden.
 */
export function normalizeSavedPicks(value: unknown): ShoppablePick[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(toPick).filter((pick): pick is ShoppablePick => pick !== null);
}
