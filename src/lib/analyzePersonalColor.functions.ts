import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  PersonalColorAnalysisInput,
  analyzePersonalColorForUser,
} from "@/server/services/personal-color-analysis";

export type {
  ColorAnalysisResult,
  StudioColorProfile,
} from "@/server/services/personal-color-analysis";

/**
 * The web client's entry point for the studio colour read. The logic — and the
 * founding-read rule — lives in `src/server/services/personal-color-analysis.ts`,
 * shared verbatim with `POST /api/v1/analysis/personal-color` for mobile.
 */
export const analyzePersonalColor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PersonalColorAnalysisInput.parse(input))
  .handler(async ({ data, context }) =>
    analyzePersonalColorForUser(context.supabase, context.userId, data),
  );
