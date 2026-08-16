import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { IN_FORCE_SUBSCRIPTION_STATUSES } from "@/constants/subscriptions";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { loadPostItems } from "@/server/services/post-items";
import type { PostItem } from "@/lib/outfit-items";

export const CreatePostInput = z.object({
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

export async function createPostService({
  supabase,
  userId,
  input: data,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  input: z.infer<typeof CreatePostInput>;
}): Promise<{ id: string }> {
  {
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
  }
}

export const UpdateCaptionInput = z.object({
  post_id: z.string().uuid(),
  caption: z.string().max(500).nullable(),
});

export async function updatePostCaptionService({
  supabase,
  userId,
  input: data,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  input: z.infer<typeof UpdateCaptionInput>;
}): Promise<{ id: string }> {
  {
    const { error } = await supabase
      .from("posts")
      .update({ caption: data.caption })
      .eq("id", data.post_id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { id: data.post_id };
  }
}

export const DeletePostInput = z.object({ post_id: z.string().uuid() });

export async function deletePostService({
  supabase,
  userId,
  input: data,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  input: z.infer<typeof DeletePostInput>;
}): Promise<{ id: string }> {
  {
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
  }
}

export async function loadFeed({
  supabase,
  userId,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
}): Promise<FeedResponse> {
  {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { count: todayCount, error: todayErr } = await supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", startOfToday.toISOString());
    if (todayErr) throw new Error(todayErr.message);

    // Post today, or the feed stays shut. Enforced here rather than in the UI:
    // withholding the rows is the only version a lurker can't read off the wire.
    if (!todayCount) return { has_posted_today: false, posts: [] };

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

    return { has_posted_today: true, posts };
  }
}

export type MemberProfile = {
  id: string;
  full_name: string | null;
  username: string | null;
  verified: boolean;
};

export type MemberProfileResponse = {
  profile: MemberProfile;
  posts: FeedPost[];
  can_view_hidden: boolean;
};

/**
 * One member's public profile and their posts.
 *
 * The privileged read is the whole reason this is not direct Supabase: the
 * `profiles` SELECT policy is own-row only, so a member cannot read anyone
 * else's name or username through RLS. `supabaseAdmin` is used for exactly that
 * lookup and nothing else — the posts below still come back through the
 * caller's own client, so `Users can view everyone's posts` decides what is
 * visible rather than this code.
 *
 * `can_view_hidden` is true only for your own profile. The moderator role that
 * would also satisfy it exists in the database but must never be surfaced in
 * the member app, so it is deliberately not consulted here.
 */
export async function loadMemberProfile({
  supabase,
  userId,
  targetUserId,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  targetUserId: string;
}): Promise<MemberProfileResponse> {
  const isSelf = targetUserId === userId;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profileRow, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,username")
    .eq("id", targetUserId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profileRow) throw new Error("Member not found.");

  const { verified } = await loadAuthorDetails([targetUserId]);

  let query = supabase
    .from("posts")
    .select("id,user_id,caption,created_at,generated_look_id,image_url_back,image_url_front,hidden")
    .eq("user_id", targetUserId)
    .order("created_at", { ascending: false })
    .limit(80);
  // A hidden post is visible to its owner only. RLS already enforces this; the
  // filter keeps a non-owner's payload from carrying rows it would drop anyway.
  if (!isSelf) query = query.eq("hidden", false);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const itemMap = await loadPostItems(
    supabase,
    (rows ?? []).map((r) => r.id),
  );

  const paths = (rows ?? []).flatMap((r) => [r.image_url_back, r.image_url_front]);
  const signed = paths.length
    ? await supabase.storage.from("posts").createSignedUrls(paths, SIGNED_URL_TTL)
    : { data: [], error: null };
  if (signed.error) throw new Error(signed.error.message);
  const urlMap = new Map<string, string>();
  (signed.data ?? []).forEach((s) => {
    if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl);
  });

  return {
    profile: {
      id: profileRow.id,
      full_name: profileRow.full_name,
      username: profileRow.username,
      verified: verified.has(targetUserId),
    },
    posts: (rows ?? []).map((r) => ({
      id: r.id,
      user_id: r.user_id,
      caption: r.caption,
      created_at: r.created_at,
      generated_look_id: r.generated_look_id,
      image_url_back: urlMap.get(r.image_url_back) ?? "",
      image_url_front: urlMap.get(r.image_url_front) ?? "",
      author_name: profileRow.full_name,
      author_verified: verified.has(targetUserId),
      is_self: isSelf,
      items: itemMap.get(r.id) ?? [],
      hidden: r.hidden,
    })),
    can_view_hidden: isSelf,
  };
}
