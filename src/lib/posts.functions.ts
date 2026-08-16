import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CreatePostInput,
  DeletePostInput,
  UpdateCaptionInput,
  createPostService,
  deletePostService,
  loadFeed,
  updatePostCaptionService,
} from "@/server/services/posts";

/**
 * The website's entry points into the OOTD feed. Thin by design — the
 * post-today gate, the image-path ownership check, the signed-URL minting and
 * the privileged author lookup live in `@/server/services/posts`, which
 * `/api/v1/posts/*` calls too.
 */
export type { FeedPost, FeedResponse } from "@/server/services/posts";

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CreatePostInput.parse(input))
  .handler(({ data, context }) =>
    createPostService({ supabase: context.supabase, userId: context.userId, input: data }),
  );

export const updatePostCaption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpdateCaptionInput.parse(input))
  .handler(({ data, context }) =>
    updatePostCaptionService({ supabase: context.supabase, userId: context.userId, input: data }),
  );

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => DeletePostInput.parse(input))
  .handler(({ data, context }) =>
    deletePostService({ supabase: context.supabase, userId: context.userId, input: data }),
  );

export const getFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => loadFeed({ supabase: context.supabase, userId: context.userId }));
