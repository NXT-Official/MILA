import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ClothingAttributesSchema } from "@/lib/outfit-items";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, jsonBody, ok } from "@/server/api/respond";
import { rankDupes } from "@/server/services/dupe-hunter";
import { toApiError } from "../look/generate";

/**
 * `POST /api/v1/dupes/similar` — similar pieces for a garment already
 * catalogued on a post.
 *
 * **Free, and no AI call.** The attributes were extracted when the post was
 * analysed, so this is a catalogue query and must never reach the paywall.
 *
 * It is an API route rather than a direct Supabase read for one reason:
 * `scoreCandidate`'s ranking is shared business logic. RLS would happily serve
 * `products` to the client, but a second copy of the scoring would mean the
 * same garment returns different matches on web and on phone.
 */
const Input = z.object({
  attributes: ClothingAttributesSchema,
  maxResults: z.number().int().min(1).max(20).optional().default(6),
});

export const Route = createFileRoute("/api/v1/dupes/similar")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { supabase } = await requireActiveMember(request);

        const parsed = Input.safeParse(await jsonBody(request));
        if (!parsed.success) {
          throw new ApiError("VALIDATION_FAILED", "That garment could not be matched.", 400);
        }

        try {
          return ok(await rankDupes(supabase, parsed.data.attributes, parsed.data.maxResults));
        } catch (error) {
          throw toApiError(error);
        }
      }),
    },
  },
});
