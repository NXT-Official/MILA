import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DailyLookSchema, GenerateLookInput, type DailyLook } from "@/lib/daily-look";
import { generateLook, renderLookImage } from "@/server/services/generate-look";

/**
 * The website's entry point into look generation. **Thin by design** — the
 * prompt, the credit charge, and the image billing all live in
 * `@/server/services/generate-look`, which `POST /api/v1/look/generate` calls
 * too. Two clients, one implementation of the business rule.
 *
 * Re-exported below: the schema and types several web modules already import
 * from this path, kept so moving the logic did not move every import with it.
 * They come from `@/lib/daily-look`, which is pure zod — re-exporting them from
 * the service would drag `ai.server` into the browser bundle, which is exactly
 * what TanStack Start's import protection stops.
 */
export { DailyLookSchema, type DailyLook, type GeneratedLook } from "@/lib/daily-look";

export const generateDailyLook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = GenerateLookInput.safeParse(input);
    if (!parsed.success) {
      throw new Error("Mila couldn't prepare your style profile for this look. Please try again.");
    }
    return parsed.data;
  })
  .handler(({ data, context }): Promise<DailyLook> =>
    generateLook({ supabase: context.supabase, userId: context.userId, input: data }),
  );

export const regenerateOutfitImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = DailyLookSchema.safeParse(input);
    if (!parsed.success) {
      console.error("[regenerateOutfitImage] invalid input", parsed.error.flatten());
      throw new Error("Mila couldn't prepare that outfit for a new visual. Please try again.");
    }
    return parsed.data;
  })
  .handler(({ data, context }) =>
    renderLookImage({ supabase: context.supabase, userId: context.userId, look: data }),
  );
