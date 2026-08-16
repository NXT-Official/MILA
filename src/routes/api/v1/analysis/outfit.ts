import { createFileRoute } from "@tanstack/react-router";
import { AnalyzeOutfitInput } from "@/lib/outfit-analysis";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, jsonBody, ok } from "@/server/api/respond";
import { analyzeOutfitLook } from "@/server/services/analyze-outfit";
import { toApiError } from "../look/generate";

/**
 * `POST /api/v1/analysis/outfit` — Lens.
 *
 * The image must already live in Mila storage; `assertTrustedStorageImageUrl`
 * inside the service enforces that. Handing the server an arbitrary client
 * URL would be a server-side request forgery primitive, which is why the check
 * is not in the client.
 */
export const Route = createFileRoute("/api/v1/analysis/outfit")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { supabase, user } = await requireActiveMember(request);

        const parsed = AnalyzeOutfitInput.safeParse(await jsonBody(request));
        if (!parsed.success) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "That photo could not be read for analysis.",
            400,
          );
        }

        try {
          return ok(await analyzeOutfitLook({ supabase, userId: user.id, input: parsed.data }));
        } catch (error) {
          throw toApiError(error);
        }
      }),
    },
  },
});
