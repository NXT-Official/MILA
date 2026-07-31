import { createServerFn } from "@tanstack/react-start";
import { IN_FORCE_SUBSCRIPTION_STATUSES } from "@/constants/subscriptions";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getCurrentUserRoles } from "@/lib/admin.functions";
import { hasPermission } from "@/lib/authorization";
import { loadPostItems } from "@/lib/outfit-items.functions";
import type { PostItem } from "@/lib/outfit-items";

const CreatePostInput = z.object({
  image_path_back: z.string().min(1),
  image_path_front: z.string().min(1),
  caption: z.string().max(500).optional().nullable(),
  generated_look_id: z.string().uuid().optional().nullable(),
});

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

async function loadAuthorDetails(userIds: string[]) {
  const names = new Map<string, string | null>();
  const verified = new Set<string>();
  if (!userIds.length) return { names, verified };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [profiles, subscriptions] = await Promise.all([
    supabaseAdmin.from("profiles").select("id,full_name").in("id", userIds),
    supabaseAdmin
      .from("subscriptions")
      .select("user_id")
      .in("user_id", userIds)
      .in("status", IN_FORCE_SUBSCRIPTION_STATUSES),
  ]);

  for (const profile of profiles.data ?? []) names.set(profile.id, profile.full_name ?? null);
  for (const row of subscriptions.data ?? []) verified.add(row.user_id);
  return { names, verified };
}

export interface FeedResponse {
  has_posted_today: boolean;
  posts: FeedPost[];
}

const SIGNED_URL_TTL = 60 * 60;

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CreatePostInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Storage RLS only constrains uploads. Without this a member could publish a
    // post pointing at someone else's image path and claim it as their own OOTD.
    const ownsBothImages = [data.image_path_back, data.image_path_front].every((path) =>
      path.startsWith(`${userId}/`),
    );
    if (!ownsBothImages) throw new Error("Post images must be your own uploads.");

    const { data: row, error } = await supabase
      .from("posts")
      .insert({
        user_id: userId,
        image_url_back: data.image_path_back,
        image_url_front: data.image_path_front,
        caption: data.caption ?? null,
        generated_look_id: data.generated_look_id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

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
  .handler(async ({ context }): Promise<FeedResponse> => {
    const { supabase, userId } = context;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { count: todayCount, error: todayErr } = await supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", startOfToday.toISOString());
    if (todayErr) throw new Error(todayErr.message);

    const { data: rows, error } = await supabase
      .from("posts")
      .select("id,user_id,caption,created_at,generated_look_id,image_url_back,image_url_front")
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    const [{ names: nameMap, verified }, itemMap] = await Promise.all([
      loadAuthorDetails(userIds),
      loadPostItems(
        supabase,
        (rows ?? []).map((r) => r.id),
      ),
    ]);

    const paths = (rows ?? []).flatMap((r) => [r.image_url_back, r.image_url_front]);
    const signed = paths.length
      ? await supabase.storage.from("posts").createSignedUrls(paths, SIGNED_URL_TTL)
      : { data: [], error: null };
    if (signed.error) throw new Error(signed.error.message);
    const urlMap = new Map<string, string>();
    (signed.data ?? []).forEach((s) => {
      if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl);
    });

    const posts: FeedPost[] = (rows ?? []).map((r) => ({
      id: r.id,
      user_id: r.user_id,
      caption: r.caption,
      created_at: r.created_at,
      generated_look_id: r.generated_look_id,
      image_url_back: urlMap.get(r.image_url_back) ?? "",
      image_url_front: urlMap.get(r.image_url_front) ?? "",
      author_name: nameMap.get(r.user_id) ?? null,
      author_verified: verified.has(r.user_id),
      is_self: r.user_id === userId,
      items: itemMap.get(r.id) ?? [],
    }));

    return { has_posted_today: (todayCount ?? 0) > 0, posts };
  });

const MemberProfileInput = z.object({ user_id: z.string().uuid() });

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
  .handler(async ({ data, context }): Promise<MemberProfileResponse> => {
    const roles = await getCurrentUserRoles(context.supabase, context.userId);
    const canViewHidden =
      data.user_id === context.userId || hasPermission(roles, "moderation.view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const profileResult = await supabaseAdmin
      .from("profiles")
      .select("id,full_name,username,color_season,face_shape,hair_type,created_at")
      .eq("id", data.user_id)
      .maybeSingle();
    if (profileResult.error || !profileResult.data) throw new Error("Member not found.");
    const profile = profileResult.data;
    const { data: activeSubscription } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id")
      .eq("user_id", profile.id)
      .in("status", IN_FORCE_SUBSCRIPTION_STATUSES)
      .limit(1)
      .maybeSingle();
    const isVerified = !!activeSubscription;

    let postsQuery = supabaseAdmin
      .from("posts")
      .select(
        "id,user_id,caption,created_at,generated_look_id,image_url_back,image_url_front,hidden,hidden_reason",
      )
      .eq("user_id", data.user_id)
      .order("created_at", { ascending: false })
      .limit(80);
    if (!canViewHidden) postsQuery = postsQuery.eq("hidden", false);
    const { data: posts, error: postsError } = await postsQuery;
    if (postsError) throw new Error("Couldn't load this member's posts.");

    const paths = (posts ?? []).flatMap((post) => [post.image_url_back, post.image_url_front]);
    // Safe on the admin client: the post list above already applied the
    // hidden/moderator rules, so only visible posts are asked about.
    const itemMap = await loadPostItems(
      supabaseAdmin,
      (posts ?? []).map((post) => post.id),
    );
    const signed = paths.length
      ? await supabaseAdmin.storage.from("posts").createSignedUrls(paths, SIGNED_URL_TTL)
      : { data: [], error: null };
    if (signed.error) throw new Error("Couldn't load this member's post images.");
    const urlMap = new Map<string, string>();
    for (const item of signed.data ?? []) {
      if (item.path && item.signedUrl) urlMap.set(item.path, item.signedUrl);
    }

    return {
      profile: { ...profile, verified: isVerified },
      can_view_hidden: canViewHidden,
      posts: (posts ?? []).map((post) => ({
        ...post,
        image_url_back: urlMap.get(post.image_url_back) ?? "",
        image_url_front: urlMap.get(post.image_url_front) ?? "",
        author_name: profile.full_name,
        author_verified: isVerified,
        is_self: post.user_id === context.userId,
        items: itemMap.get(post.id) ?? [],
      })),
    };
  });
