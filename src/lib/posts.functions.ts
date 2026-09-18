import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { PostItem } from "@/lib/outfit-items";
import {
  createPostForUser,
  getFeedForUser,
  getMemberProfileForUser,
} from "@/server/services/posts";

export const CreatePostInput = z.object({
  image_path_back: z.string().min(1),
  image_path_front: z.string().min(1),
  caption: z.string().max(500).optional().nullable(),
  generated_look_id: z.string().uuid().optional().nullable(),
});
export type CreatePostInputData = z.infer<typeof CreatePostInput>;

export interface FeedPost {
  id: string;
  user_id: string;
  caption: string | null;
  created_at: string;
  generated_look_id: string | null;
  image_url_back: string;
  image_url_front: string;
  author_name: string | null;
  author_verified: boolean;
  is_self: boolean;
  /** Garments detected in the back capture; empty when detection was skipped or failed. */
  items: PostItem[];
  hidden?: boolean;
  hidden_reason?: string | null;
}

export interface FeedResponse {
  has_posted_today: boolean;
  posts: FeedPost[];
}

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CreatePostInput.parse(input))
  .handler(async ({ data, context }) => createPostForUser(context.supabase, context.userId, data));

const UpdateCaptionInput = z.object({
  post_id: z.string().uuid(),
  caption: z.string().max(500).nullable(),
});

export const updatePostCaption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpdateCaptionInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("posts")
      .update({ caption: data.caption })
      .eq("id", data.post_id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { id: data.post_id };
  });

const DeletePostInput = z.object({ post_id: z.string().uuid() });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => DeletePostInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error: readErr } = await supabase
      .from("posts")
      .select("image_url_back,image_url_front")
      .eq("id", data.post_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Post not found.");

    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", data.post_id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    const { error: removeError } = await supabase.storage
      .from("posts")
      .remove([row.image_url_back, row.image_url_front]);
    // The row is already gone; a failed purge only leaves orphaned bytes behind,
    // so surface it for cleanup rather than failing a delete the user saw succeed.
    if (removeError) console.error("[deletePost] image purge failed", removeError.message);
    return { id: data.post_id };
  });

export const getFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FeedResponse> =>
    getFeedForUser(context.supabase, context.userId),
  );

export const MemberProfileInput = z.object({ user_id: z.string().uuid() });
export type MemberProfileInputData = z.infer<typeof MemberProfileInput>;

export interface MemberProfileResponse {
  profile: {
    id: string;
    full_name: string | null;
    username: string | null;
    color_season: string | null;
    face_shape: string | null;
    hair_type: string | null;
    created_at: string;
    verified: boolean;
  };
  posts: FeedPost[];
  can_view_hidden: boolean;
}

export const getMemberProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MemberProfileInput.parse(input))
  .handler(async ({ data, context }): Promise<MemberProfileResponse> =>
    getMemberProfileForUser(context.supabase, context.userId, data),
  );
