import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { CreatePostInput } from "@/lib/posts.functions";
import { createPostForUser } from "@/server/services/posts";

export type HandlePostsCreateDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  createPostForUser: typeof createPostForUser;
};

const defaultDeps: HandlePostsCreateDeps = { verifyBearerAuth, createPostForUser };

/**
 * `POST /api/v1/posts/create` — mirrors `createPost` in
 * `src/lib/posts.functions.ts`. Free, no rate limit. See
 * `MILA_MOBILE/src/services/api/posts.ts`.
 */
export async function handlePostsCreate(
  request: Request,
  deps: HandlePostsCreateDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const input = CreatePostInput.parse(body);

    const post = await deps.createPostForUser(supabase, userId, input);
    return Response.json(post);
  } catch (error) {
    return respondWithError("posts/create", error);
  }
}

export const Route = createFileRoute("/api/v1/posts/create")({
  server: {
    handlers: {
      POST: async ({ request }) => handlePostsCreate(request),
    },
  },
});
