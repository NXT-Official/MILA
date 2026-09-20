import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ClothingAttributesSchema, type ClothingAttributes } from "./outfit-items";
import { findDupesForUser, findSimilarItemsForUser } from "@/server/services/dupes";

export const Input = z.object({
  imageUrl: z.string().url(),
  maxResults: z.number().int().min(1).max(20).optional().default(6),
  /** ISO 3166-1 alpha-2 country code. Empty/omitted = unknown, don't region-filter. */
  region: z.string().length(2).optional(),
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
};

export type DupeHuntResult = {
  inspiration: ClothingAttributes;
  dupes: DupeMatch[];
};

export const FindSimilarItemsInput = z.object({
  attributes: ClothingAttributesSchema,
  maxResults: z.number().int().min(1).max(20).optional().default(6),
  region: z.string().length(2).optional(),
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
    findSimilarItemsForUser(context.supabase, data),
  );

/**
 * Vision extraction (1 AI credit) + catalogue ranking. The pipeline lives in
 * `src/server/services/dupes.ts`, shared verbatim with the mobile
 * `POST /api/v1/dupes/find` route.
 */
export const findDupes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(({ data, context }): Promise<DupeHuntResult> =>
    findDupesForUser(context.supabase, context.userId, data),
  );
