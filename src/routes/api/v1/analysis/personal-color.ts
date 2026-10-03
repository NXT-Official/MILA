import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import {
  PersonalColorAnalysisInput,
  analyzePersonalColorForUser,
} from "@/server/services/personal-color-analysis";

export type HandleAnalysisPersonalColorDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  analyzePersonalColorForUser: typeof analyzePersonalColorForUser;
};

const defaultDeps: HandleAnalysisPersonalColorDeps = {
  verifyBearerAuth,
  analyzePersonalColorForUser,
};

/**
 * `POST /api/v1/analysis/personal-color` — mirrors `analyzePersonalColor` in
 * `src/lib/analyzePersonalColor.functions.ts`, result shape included: failures
 * ride a **200** as `{ success: false, error }` (the §6 contract for this
 * endpoint), and the client maps the codes — `INSUFFICIENT_CREDITS` opens the
 * paywall, never a generic error. The founding read (no colour dossier yet) is
 * free; re-reads cost **1 AI credit**; 10/hour either way. See
 * `MILA_MOBILE/src/services/api/analysis.ts` for the mobile contract.
 */
export async function handleAnalysisPersonalColor(
  request: Request,
  deps: HandleAnalysisPersonalColorDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const input = PersonalColorAnalysisInput.parse(body);

    const result = await deps.analyzePersonalColorForUser(supabase, userId, input);
    return Response.json(result);
  } catch (error) {
    return respondWithError("analysis/personal-color", error);
  }
}

export const Route = createFileRoute("/api/v1/analysis/personal-color")({
  server: {
    handlers: {
      POST: async ({ request }) => handleAnalysisPersonalColor(request),
    },
  },
});
