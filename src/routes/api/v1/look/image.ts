import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { DomainValidationError } from "@/server/http/api-errors";
import { DailyLookSchema } from "@/lib/generate-outfit.functions";
import { renderLookImageForUser } from "@/server/services/look";

export type HandleLookImageDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  renderLookImageForUser: typeof renderLookImageForUser;
};

const defaultDeps: HandleLookImageDeps = { verifyBearerAuth, renderLookImageForUser };

/**
 * `POST /api/v1/look/image` — mirrors `regenerateOutfitImage` in
 * `src/lib/generate-outfit.functions.ts`. Free the first time per look
 * (claims `look_image_pending`), otherwise 1 AI credit. The body is the raw
 * `DailyLook` object mobile just received from `/look/generate` — see
 * `MILA_MOBILE/src/services/api/look.ts`.
 *
 * A failed render is not an HTTP error: it answers `200` with
 * `{ imageDataUri: null, imageGenerationError }` so the client keeps the
 * written look on screen and offers a retry (§8 partial-success contract).
 */
export async function handleLookImage(
  request: Request,
  deps: HandleLookImageDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const parsed = DailyLookSchema.safeParse(body);
    if (!parsed.success) {
      console.error("[look/image] invalid input", parsed.error.flatten());
      throw new DomainValidationError(
        "Mila couldn't prepare that outfit for a new visual. Please try again.",
      );
    }

    const result = await deps.renderLookImageForUser(supabase, userId, parsed.data);
    return Response.json(result);
  } catch (error) {
    return respondWithError("look/image", error);
  }
}

export const Route = createFileRoute("/api/v1/look/image")({
  server: {
    handlers: {
      POST: async ({ request }) => handleLookImage(request),
    },
  },
});
