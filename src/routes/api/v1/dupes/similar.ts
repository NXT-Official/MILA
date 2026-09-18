import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { FindSimilarItemsInput } from "@/lib/dupe-hunter.functions";
import { findSimilarItemsForUser } from "@/server/services/dupes";

export type HandleDupesSimilarDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  findSimilarItemsForUser: typeof findSimilarItemsForUser;
};

const defaultDeps: HandleDupesSimilarDeps = { verifyBearerAuth, findSimilarItemsForUser };

/**
 * `POST /api/v1/dupes/similar` — mirrors `findSimilarItems` in
 * `src/lib/dupe-hunter.functions.ts`. **Free, no AI call.** See
 * `MILA_MOBILE/src/services/api/items.ts`.
 */
export async function handleDupesSimilar(
  request: Request,
  deps: HandleDupesSimilarDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const input = FindSimilarItemsInput.parse(body);

    const matches = await deps.findSimilarItemsForUser(supabase, input);
    return Response.json(matches);
  } catch (error) {
    return respondWithError("dupes/similar", error);
  }
}

export const Route = createFileRoute("/api/v1/dupes/similar")({
  server: {
    handlers: {
      POST: async ({ request }) => handleDupesSimilar(request),
    },
  },
});
