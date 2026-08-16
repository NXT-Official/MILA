import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ClothingAttributesSchema } from "./outfit-items";
import { DupeHuntInput, huntDupes, rankDupes } from "@/server/services/dupe-hunter";

/**
 * The website's entry points into dupe hunting. Thin by design — the vision
 * prompt, the credit charge, and `scoreCandidate`'s ranking live in
 * `@/server/services/dupe-hunter`, which `/api/v1/dupes/*` calls too.
 *
 * Types only below. Re-exporting a *value* from the service would drag
 * `ai.server` into the browser bundle, which is what TanStack Start's import
 * protection stops — the same trap `daily-look.ts` exists to avoid.
 */
export type { DupeMatch, DupeHuntResult } from "@/server/services/dupe-hunter";

/**
 * Similar pieces for a garment Mila already catalogued on a post. Skips the
 * vision step findDupes needs, so opening a hotspot drawer costs one query.
 */
export const findSimilarItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        attributes: ClothingAttributesSchema,
        maxResults: z.number().int().min(1).max(20).optional().default(6),
      })
      .parse(input),
  )
  .handler(({ data, context }) => rankDupes(context.supabase, data.attributes, data.maxResults));

export const findDupes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => DupeHuntInput.parse(input))
  .handler(({ data, context }) =>
    huntDupes({ supabase: context.supabase, userId: context.userId, input: data }),
  );
