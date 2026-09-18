import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { AnalyzeOutfitItemsInput } from "@/lib/outfit-items.functions";
import { analyzeOutfitItemsForUser } from "@/server/services/items";

export type HandleItemsAnalyzeDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  analyzeOutfitItemsForUser: typeof analyzeOutfitItemsForUser;
};

const defaultDeps: HandleItemsAnalyzeDeps = { verifyBearerAuth, analyzeOutfitItemsForUser };

/**
 * `POST /api/v1/items/analyze` — mirrors `analyzeOutfitItems` in
 * `src/lib/outfit-items.functions.ts`. **1 AI credit, refunded if nothing is
 * detected**, 10/hour. See `MILA_MOBILE/src/services/api/items.ts`.
 */
export async function handleItemsAnalyze(
  request: Request,
  deps: HandleItemsAnalyzeDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const input = AnalyzeOutfitItemsInput.parse(body);

    const items = await deps.analyzeOutfitItemsForUser(supabase, userId, input);
    return Response.json(items);
  } catch (error) {
    return respondWithError("items/analyze", error);
  }
}

export const Route = createFileRoute("/api/v1/items/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => handleItemsAnalyze(request),
    },
  },
});
