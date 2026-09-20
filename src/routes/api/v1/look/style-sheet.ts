import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { DomainValidationError } from "@/server/http/api-errors";
import { Input as StyleSheetInputSchema } from "@/lib/style-sheet.functions";
import { renderStyleSheetForUser } from "@/server/services/style-sheet";

export type HandleLookStyleSheetDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  renderStyleSheetForUser: typeof renderStyleSheetForUser;
};

const defaultDeps: HandleLookStyleSheetDeps = { verifyBearerAuth, renderStyleSheetForUser };

/**
 * `POST /api/v1/look/style-sheet` — mirrors `generateStyleSheetPreview` in
 * `src/lib/style-sheet.functions.ts`. Renders the identity-locked 5-view
 * style sheet from the member's consented selfie. Free the first time per
 * look (`look_image_pending`), otherwise 1 AI credit. The body is the
 * `DailyLook` object mobile just received from `/look/generate` — see
 * `MILA_MOBILE/src/services/api/look.ts`.
 *
 * "No consented photo on file" and a failed QA check are not HTTP errors:
 * they answer `200` with `{ imageDataUri: null, mode: "unavailable", reason }`
 * so the client keeps the written look on screen and offers a retry.
 */
export async function handleLookStyleSheet(
  request: Request,
  deps: HandleLookStyleSheetDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const parsed = StyleSheetInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainValidationError(
        "Mila couldn't prepare that look for a style sheet. Please try again.",
      );
    }

    const result = await deps.renderStyleSheetForUser(supabase, userId, parsed.data);
    return Response.json(result);
  } catch (error) {
    return respondWithError("look/style-sheet", error);
  }
}

export const Route = createFileRoute("/api/v1/look/style-sheet")({
  server: {
    handlers: {
      POST: async ({ request }) => handleLookStyleSheet(request),
    },
  },
});
