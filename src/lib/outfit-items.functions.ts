import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  UpdatePostItemsInput,
  analyzePostItems,
  updatePostItemsService,
} from "@/server/services/post-items";

/**
 * The website's entry points into garment tagging. Thin by design — the vision
 * prompt, the rate limit, the credit charge, and the replace-not-patch
 * semantics live in `@/server/services/post-items`, which
 * `POST /api/v1/items/analyze` calls too.
 *
 * `loadPostItems` and `toPostItem` moved to the service with the rest; callers
 * import them from there directly rather than through this module.
 */
export type { PostItem } from "@/lib/outfit-items";

export const updatePostItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpdatePostItemsInput.parse(input))
  .handler(({ data, context }) =>
    updatePostItemsService({ supabase: context.supabase, userId: context.userId, input: data }),
  );

export const analyzeOutfitItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ post_id: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    analyzePostItems({ supabase: context.supabase, userId: context.userId, input: data }),
  );
