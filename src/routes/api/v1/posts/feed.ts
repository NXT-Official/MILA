import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { respondWithError } from "@/server/http/respond";
import { getFeedForUser } from "@/server/services/posts";

export type HandlePostsFeedDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  getFeedForUser: typeof getFeedForUser;
};

const defaultDeps: HandlePostsFeedDeps = { verifyBearerAuth, getFeedForUser };

/**
 * `GET /api/v1/posts/feed` — mirrors `getFeed` in `src/lib/posts.functions.ts`.
 * Free, no rate limit. See `MILA_MOBILE/src/services/api/posts.ts`.
 */
export async function handlePostsFeed(
  request: Request,
  deps: HandlePostsFeedDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const feed = await deps.getFeedForUser(supabase, userId);
    return Response.json(feed);
  } catch (error) {
    return respondWithError("posts/feed", error);
  }
}

export const Route = createFileRoute("/api/v1/posts/feed")({
  server: {
    handlers: {
      GET: async ({ request }) => handlePostsFeed(request),
    },
  },
});
