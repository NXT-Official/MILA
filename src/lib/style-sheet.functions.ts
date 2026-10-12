import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DailyLookSchema } from "./generate-outfit.functions";
import { renderStyleSheetForUser, type StyleSheetResponse } from "@/server/services/style-sheet";

export const Input = z.object({
  outfit: DailyLookSchema,
  /** Idempotency key for this render (a UUID the client picks once per
   * press). The same key never charges twice and replays the stored sheet.
   * Optional: clients that predate generation jobs keep working without it. */
  clientRequestId: z.string().uuid().optional(),
});

export type { StyleSheetPreviewResult, StyleSheetResponse } from "@/server/services/style-sheet";

/**
 * Renders the identity-locked 5-view style sheet for today's recommended
 * look (outfit + real shoppable picks, composed by generateLookForUser).
 *
 * The pipeline itself lives in `src/server/services/style-sheet.ts` — shared
 * verbatim with the mobile `POST /api/v1/look/style-sheet` route so both
 * clients run one implementation of the consent gate, credit mechanism, and
 * retry-on-failed-QA shape (Phase 11 shared-service extraction).
 *
 * Runs as a generation job: answers today's result plus `jobId` once jobs are
 * live, and waits for a sheet that is already rendering instead of charging
 * again, so the dashboard's result contract is unchanged.
 */
export const generateStyleSheetPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<StyleSheetResponse> =>
    renderStyleSheetForUser(context.supabase, context.userId, data),
  );
