import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { Input as AnalyzeOutfitInputSchema } from "@/lib/analyze-outfit.functions";
import { analyzeOutfitForUser } from "@/server/services/outfit-analysis";

export type HandleAnalysisOutfitDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  analyzeOutfitForUser: typeof analyzeOutfitForUser;
};

const defaultDeps: HandleAnalysisOutfitDeps = { verifyBearerAuth, analyzeOutfitForUser };

/**
 * `POST /api/v1/analysis/outfit` — mirrors `analyzeOutfit` in
 * `src/lib/analyze-outfit.functions.ts`. **1 AI credit**, 15/hour. See
 * `MILA_MOBILE/src/services/api/analysis.ts` for the exact contract.
 */
export async function handleAnalysisOutfit(
  request: Request,
  deps: HandleAnalysisOutfitDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const input = AnalyzeOutfitInputSchema.parse(body);

    const result = await deps.analyzeOutfitForUser(supabase, userId, input);
    return Response.json(result);
  } catch (error) {
    return respondWithError("analysis/outfit", error);
  }
}

export const Route = createFileRoute("/api/v1/analysis/outfit")({
  server: {
    handlers: {
      POST: async ({ request }) => handleAnalysisOutfit(request),
    },
  },
});
