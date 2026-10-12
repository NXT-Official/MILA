import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ClothingAttributesSchema, type ClothingAttributes } from "./outfit-items";
import { DUPE_SPEC_OPTIONAL_FIELDS, type DupeSpecFields, type MatchQuality } from "./dupe-spec";
import { findDupesForUser, findSimilarItemsForUser } from "@/server/services/dupes";

/** A hard price ceiling, in the catalog's currency (USD), the user set for
 * this search. Optional — omitted means no limit. */
const maxBudgetSchema = z.number().positive().max(1_000_000).optional();

export const Input = z.object({
  imageUrl: z.string().url(),
  maxResults: z.number().int().min(1).max(20).optional().default(6),
  /** ISO 3166-1 alpha-2 country code. Empty/omitted = unknown, don't region-filter. */
  region: z.string().length(2).optional(),
  maxBudget: maxBudgetSchema,
  /** Optional so older clients keep working: with it a repeat is replayed
   * instead of charged again, and the hunt can be picked up after she
   * leaves. */
  clientRequestId: z.string().uuid().optional(),
});
export type FindDupesInputData = z.infer<typeof Input>;

export type DupeMatch = {
  id: string;
  title: string;
  brand_id: string;
  category: string;
  price: number;
  currency: string;
  image_url: string | null;
  affiliate_link: string;
  description: string | null;
  match_score: number;
  match_reasons: string[];
  verification_status: string;
  last_verified_at: string | null;
  rating: number | null;
  units_sold: number | null;
  shipping_info: string | null;
  discount_percent: number | null;
  is_verified_seller: boolean;
  /** How close this piece is to the inspiration, 0-100, from the catalogue
   * text score (src/server/services/dupe-match.ts). Always set by the current
   * server; optional so older payloads still type-check. */
  similarity?: number;
  /** One plain line on why it matches, e.g. "Same striped navy wool coat".
   * Also the first entry of `match_reasons`. */
  matchReason?: string;
};

export type DupeHuntResult = {
  /** The vision read. The identification fields (garment_type, gender_fit,
   * formality, closure, pattern, colors, length, fabric, key_details) are
   * present on hunts run by the current server. */
  inspiration: ClothingAttributes & Partial<DupeSpecFields>;
  dupes: DupeMatch[];
  /** The identification as one plain line, e.g. "A women's navy and white
   * striped double-breasted wool coat, knee length, formal". */
  identifiedAs?: string;
  /** "identical" (best match 90+), "close" (60-89), or "none": nothing is
   * shown. Thresholds are uncalibrated (see MIN_DUPE_SIMILARITY). */
  matchQuality?: MatchQuality;
  /** Member-facing line for the "none" case: "Nothing in our catalogue is
   * close enough to this coat yet." (credit refunded, within a daily cap),
   * or "Close matches exist above your budget." / "...outside your region."
   * when her own filters hid close matches (charged as normal). */
  message?: string;
  /** Set when close matches exist but her budget or region filter hid them,
   * so a client can offer to widen the search. */
  hiddenByFilters?: { aboveBudget: boolean; outsideRegion: boolean };
  /** True when nothing in the catalogue was close and this hunt's credit was
   * refunded (at most 3 a day). Absent when the hunt was charged. */
  creditRefunded?: boolean;
  /** The generation job that carried the hunt; absent until the migration is
   * applied, and when the hunt was delivered without being stored. */
  jobId?: string;
};

export const FindSimilarItemsInput = z.object({
  /** Stored post-item attributes; the optional spec fields sharpen the
   * match when a client has them. */
  attributes: ClothingAttributesSchema.extend(DUPE_SPEC_OPTIONAL_FIELDS),
  maxResults: z.number().int().min(1).max(20).optional().default(6),
  region: z.string().length(2).optional(),
  maxBudget: maxBudgetSchema,
});
export type FindSimilarItemsInputData = z.infer<typeof FindSimilarItemsInput>;

/**
 * Similar pieces for a garment Mila already catalogued on a post. Skips the
 * vision step findDupes needs, so opening a hotspot drawer costs one query.
 *
 * The ranking itself lives in `src/server/services/dupes.ts` — shared
 * verbatim with the mobile `POST /api/v1/dupes/similar` route so the same
 * garment returns identical matches on both clients (Phase 11
 * shared-service extraction).
 */
export const findSimilarItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => FindSimilarItemsInput.parse(input))
  .handler(({ data, context }): Promise<DupeMatch[]> =>
    findSimilarItemsForUser(context.supabase, context.userId, data),
  );

/**
 * Vision extraction (1 AI credit) + catalogue ranking. The pipeline lives in
 * `src/server/services/dupes.ts`, shared verbatim with the mobile
 * `POST /api/v1/dupes/find` route. Runs as a generation job; a second hunt
 * sent while one is running waits for it ("attach") rather than answering
 * `{ status: 'running' }`, which this caller does not handle.
 */
export const findDupes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(({ data, context }): Promise<DupeHuntResult> =>
    findDupesForUser(context.supabase, context.userId, data, undefined, { inFlight: "attach" }),
  );
