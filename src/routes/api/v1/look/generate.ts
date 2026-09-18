import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { DomainValidationError } from "@/server/http/api-errors";
import { Input as GenerateLookInputSchema } from "@/lib/generate-outfit.functions";
import { generateLookForUser } from "@/server/services/look";

export type HandleLookGenerateDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  generateLookForUser: typeof generateLookForUser;
};

const defaultDeps: HandleLookGenerateDeps = { verifyBearerAuth, generateLookForUser };

/**
 * `POST /api/v1/look/generate` — mirrors `generateDailyLook` in
 * `src/lib/generate-outfit.functions.ts`. **1 AI credit.** See
 * `MILA_MOBILE/src/services/api/look.ts` for the exact request/response
 * contract this must satisfy.
 */
export async function handleLookGenerate(
  request: Request,
  deps: HandleLookGenerateDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const parsed = GenerateLookInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainValidationError(
        "Mila couldn't prepare your style profile for this look. Please try again.",
      );
    }

    const look = await deps.generateLookForUser(supabase, userId, parsed.data);
    return Response.json(look);
  } catch (error) {
    return respondWithError("look/generate", error);
  }
}

export const Route = createFileRoute("/api/v1/look/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => handleLookGenerate(request),
    },
  },
});
