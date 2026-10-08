import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { DomainValidationError } from "@/server/http/api-errors";
import { Input as PhotoPreviewInputSchema } from "@/lib/photo-preview.functions";
import { renderPhotoPreviewForUser } from "@/server/services/photo-preview";

export type HandleLookPhotoPreviewDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  renderPhotoPreviewForUser: typeof renderPhotoPreviewForUser;
};

const defaultDeps: HandleLookPhotoPreviewDeps = { verifyBearerAuth, renderPhotoPreviewForUser };

/**
 * `POST /api/v1/look/photo-preview` — mirrors `generatePhotoPreview` in
 * `src/lib/photo-preview.functions.ts`. Composites the recommended outfit
 * onto the member's consented selfie. Free the first time per look
 * (`look_image_pending`), otherwise 1 AI credit. The body is the
 * `DailyLook` object mobile just received from `/look/generate` — see
 * `MILA_MOBILE/src/services/api/look.ts`.
 *
 * "No consented photo on file" and a failed verification are not HTTP
 * errors: they answer `200` with
 * `{ imageDataUri: null, mode: "unavailable", reason }` so the client keeps
 * the written look on screen and offers a retry.
 *
 * Generation jobs: an optional `clientRequestId` (UUID) makes the request
 * idempotent (a repeat replays the stored portrait, no second charge); while
 * another portrait is still rendering it answers
 * `200 { status: "running", jobId }`. Without one (builds that predate jobs)
 * the route waits for that portrait and answers it. Responses carry `jobId`
 * once the migration is applied.
 */
export async function handleLookPhotoPreview(
  request: Request,
  deps: HandleLookPhotoPreviewDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const parsed = PhotoPreviewInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainValidationError(
        "Mila couldn't prepare that look for a photo preview. Please try again.",
      );
    }

    const result = parsed.data.clientRequestId
      ? await deps.renderPhotoPreviewForUser(supabase, userId, parsed.data, { inFlight: "report" })
      : await deps.renderPhotoPreviewForUser(supabase, userId, parsed.data);
    return Response.json(result);
  } catch (error) {
    return respondWithError("look/photo-preview", error);
  }
}

export const Route = createFileRoute("/api/v1/look/photo-preview")({
  server: {
    handlers: {
      POST: async ({ request }) => handleLookPhotoPreview(request),
    },
  },
});
