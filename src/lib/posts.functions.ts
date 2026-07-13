import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getCurrentUserRoles } from "@/lib/admin.functions";
import { hasPermission } from "@/lib/authorization";

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
  is_self: boolean;
  hidden?: boolean;
  hidden_reason?: string | null;
}

export interface FeedResponse {
  has_posted_today: boolean;
  posts: FeedPost[];
}

const SIGNED_URL_TTL = 60 * 60;

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CreatePostInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
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

export const getTodayPostStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { count, error } = await supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", startOfTodayIso());
    if (error) throw new Error(error.message);
    return { has_posted_today: (count ?? 0) > 0 };
  });

export const getFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FeedResponse> => {
    const { supabase, userId } = context;

    const { count: todayCount, error: todayErr } = await supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", startOfTodayIso());
    if (todayErr) throw new Error(todayErr.message);

    const hasPostedToday = (todayCount ?? 0) > 0;
    if (!hasPostedToday) {
      return { has_posted_today: false, posts: [] };
    }

    const { data: rows, error } = await supabase
      .from("posts")
      .select("id,user_id,caption,created_at,generated_look_id,image_url_back,image_url_front")
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    let nameMap = new Map<string, string | null>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id,full_name")
        .in("id", userIds);
      nameMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? null]));
    }

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
      is_self: r.user_id === userId,
    }));

    return { has_posted_today: true, posts };
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
    const signed = paths.length
      ? await supabaseAdmin.storage.from("posts").createSignedUrls(paths, SIGNED_URL_TTL)
      : { data: [], error: null };
    if (signed.error) throw new Error("Couldn't load this member's post images.");
    const urlMap = new Map<string, string>();
    for (const item of signed.data ?? []) {
      if (item.path && item.signedUrl) urlMap.set(item.path, item.signedUrl);
    }

    return {
      profile,
      can_view_hidden: canViewHidden,
      posts: (posts ?? []).map((post) => ({
        ...post,
        image_url_back: urlMap.get(post.image_url_back) ?? "",
        image_url_front: urlMap.get(post.image_url_front) ?? "",
        author_name: profile.full_name,
        is_self: post.user_id === context.userId,
      })),
    };
  });
