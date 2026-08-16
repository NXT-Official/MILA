import { createFileRoute } from "@tanstack/react-router";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, jsonBody, ok } from "@/server/api/respond";
import { CreatePostInput, createPostService } from "@/server/services/posts";
import { toApiError } from "../look/generate";

/**
 * `POST /api/v1/posts/create` — publish an OOTD.
 *
 * Kept server-side against the audit's first instinct. `createPostService`
 * checks that both image paths start with the caller's own id, and storage RLS
 * only constrains *uploads* — without that check a member could publish a post
 * pointing at someone else's image and claim it as their OOTD. On the client
 * that check would not be a security control at all.
 */
export const Route = createFileRoute("/api/v1/posts/create")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { supabase, user } = await requireActiveMember(request);

        const parsed = CreatePostInput.safeParse(await jsonBody(request));
        if (!parsed.success) {
          throw new ApiError("VALIDATION_FAILED", "That post could not be published.", 400);
        }

        try {
          return ok(await createPostService({ supabase, userId: user.id, input: parsed.data }));
        } catch (error) {
          throw toApiError(error);
        }
      }),
    },
  },
});
