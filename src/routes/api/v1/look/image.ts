import { createFileRoute } from "@tanstack/react-router";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, jsonBody, ok } from "@/server/api/respond";
import { DailyLookSchema } from "@/lib/daily-look";
import { renderLookImage } from "@/server/services/generate-look";
import { toApiError } from "./generate";

/**
 * `POST /api/v1/look/image` — renders the visual for an already-composed look.
 *
 * Deliberately a second call, in order: the composition charged a credit and set
 * `look_image_pending`, and `payForLookImage` inside the service claims that
 * flag so the first render is free. Merging the two would change the billing.
 *
 * A null `imageDataUri` is a **success**, not an error — the service has already
 * re-marked the pending flag or refunded, and the written look is still the
 * product. Mobile renders its image-failed state from that null.
 */
export const Route = createFileRoute("/api/v1/look/image")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { supabase, user } = await requireActiveMember(request);

        const parsed = DailyLookSchema.safeParse(await jsonBody(request));
        if (!parsed.success) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "Mila couldn't prepare that outfit for a new visual.",
            400,
          );
        }

        try {
          return ok(await renderLookImage({ supabase, userId: user.id, look: parsed.data }));
        } catch (error) {
          throw toApiError(error);
        }
      }),
    },
  },
});
