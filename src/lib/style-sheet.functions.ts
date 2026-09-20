import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DailyLookSchema } from "./generate-outfit.functions";
import {
  renderStyleSheetForUser,
  type StyleSheetPreviewResult,
} from "@/server/services/style-sheet";

export const Input = z.object({
  outfit: DailyLookSchema,
});

export type { StyleSheetPreviewResult } from "@/server/services/style-sheet";

/**
 * Renders the identity-locked 5-view style sheet for today's recommended
 * look (outfit + real shoppable picks, composed by generateLookForUser).
 *
 * The pipeline itself lives in `src/server/services/style-sheet.ts` — shared
 * verbatim with the mobile `POST /api/v1/look/style-sheet` route so both
 * clients run one implementation of the consent gate, credit mechanism, and
 * retry-on-failed-QA shape (Phase 11 shared-service extraction).
 */
export const generateStyleSheetPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<StyleSheetPreviewResult> =>
    renderStyleSheetForUser(context.supabase, context.userId, data),
  );
