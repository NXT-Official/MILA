import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, jsonBody, ok } from "@/server/api/respond";
import { analyzePostItems } from "@/server/services/post-items";
import { toApiError } from "../look/generate";

/**
 * `POST /api/v1/items/analyze` — detects garments on one of your own posts.
 *
 * Takes a `post_id`, never an image URL. The service reads the stored path and
 * mints its own short-lived signed URL, so no client-supplied URL ever reaches
 * the vision provider — the same SSRF reasoning as `/analysis/outfit`.
 *
 * One vision call per post, not per garment: N calls would be N times the
 * latency and N times the credit spend for the same photo.
 */
const Input = z.object({ post_id: z.string().uuid() });

export const Route = createFileRoute("/api/v1/items/analyze")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { supabase, user } = await requireActiveMember(request);

        const parsed = Input.safeParse(await jsonBody(request));
        if (!parsed.success) {
          throw new ApiError("VALIDATION_FAILED", "That post could not be analysed.", 400);
        }

        try {
          return ok(await analyzePostItems({ supabase, userId: user.id, input: parsed.data }));
        } catch (error) {
          throw toApiError(error);
        }
      }),
    },
  },
});
