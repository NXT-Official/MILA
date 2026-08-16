import { createFileRoute } from "@tanstack/react-router";
import { requireActiveMember } from "@/server/api/auth";
import { handler, ok } from "@/server/api/respond";
import { loadFeed } from "@/server/services/posts";
import { toApiError } from "../look/generate";

/**
 * `GET /api/v1/posts/feed` — the OOTD feed.
 *
 * Server-side because the author names come from other members' `profiles`
 * rows, which the caller's own RLS cannot read. Note what is *not* delegated:
 * the post-today gate lives in the service and withholds the rows entirely,
 * which is the only version of that rule a lurker cannot read off the wire.
 */
export const Route = createFileRoute("/api/v1/posts/feed")({
  server: {
    handlers: {
      GET: handler(async (request) => {
        const { supabase, user } = await requireActiveMember(request);
        try {
          return ok(await loadFeed({ supabase, userId: user.id }));
        } catch (error) {
          throw toApiError(error);
        }
      }),
    },
  },
});
