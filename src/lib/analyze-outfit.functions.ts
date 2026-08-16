import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AnalyzeOutfitInput } from "@/lib/outfit-analysis";
import { analyzeOutfitLook } from "@/server/services/analyze-outfit";

/**
 * The website's entry point into outfit analysis. Thin by design — the prompt,
 * the rate limit and the credit charge live in
 * `@/server/services/analyze-outfit`, which `POST /api/v1/analysis/outfit`
 * calls too.
 */
export type { OutfitAnalysis } from "@/lib/outfit-analysis";

export const analyzeOutfit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => AnalyzeOutfitInput.parse(input))
  .handler(({ data, context }) =>
    analyzeOutfitLook({ supabase: context.supabase, userId: context.userId, input: data }),
  );
