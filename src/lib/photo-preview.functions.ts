import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DailyLookSchema } from "./generate-outfit.functions";
import {
  renderPhotoPreviewForUser,
  type PhotoPreviewResult,
} from "@/server/services/photo-preview";

export const Input = z.object({
  outfit: DailyLookSchema,
});

export type { PhotoPreviewResult } from "@/server/services/photo-preview";

/**
 * Renders the single-photo edit preview (the member's own consented selfie
 * with the recommended outfit composited on) — the optional secondary visual
 * beside the style sheet.
 *
 * The pipeline itself lives in `src/server/services/photo-preview.ts` —
 * shared verbatim with the mobile `POST /api/v1/look/photo-preview` route so
 * both clients run one implementation of the consent gate, protected-region
 * QA check, and face-match verification (Phase 11 shared-service extraction).
 */
export const generatePhotoPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<PhotoPreviewResult> =>
    renderPhotoPreviewForUser(context.supabase, context.userId, data),
  );
