import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { IN_FORCE_SUBSCRIPTION_STATUSES } from "@/constants/subscriptions";
import { getCurrentUserRoles, hasPermission } from "@/lib/authorization";
import { loadPostItems } from "@/lib/outfit-items.functions";
import { DomainValidationError } from "@/server/http/api-errors";
import type {
  CreatePostInputData,
  FeedPost,
  FeedResponse,
  MemberProfileInputData,
  MemberProfileResponse,
} from "@/lib/posts.functions";

type MilaSupabaseClient = SupabaseClient<Database>;

const SIGNED_URL_TTL = 60 * 60;

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

/**
 * Publishes a new OOTD post. Free, no rate limit. Shared verbatim by the web
 * `createPost` server function and the mobile `POST /api/v1/posts/create`
 * route.
 *
 * Takes storage **paths**, not URLs — both must start with `${userId}/`.
 * Storage RLS only constrains uploads; without this re-check a member could
 * publish a post pointing at someone else's image path and claim it as their
 * own.
 */
export async function createPostForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: CreatePostInputData,
): Promise<{ id: string }> {
  const ownsBothImages = [data.image_path_back, data.image_path_front].every((path) =>
    path.startsWith(`${userId}/`),
  );
  if (!ownsBothImages) throw new DomainValidationError("Post images must be your own uploads.");

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

/**
 * The public feed: up to 80 visible posts with fresh 1-hour signed image
 * URLs. Free, no rate limit. Shared verbatim by the web `getFeed` server
 * function and the mobile `GET /api/v1/posts/feed` route.
 */
export async function getFeedForUser(
  supabase: MilaSupabaseClient,
  userId: string,
): Promise<FeedResponse> {
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
}

/**
 * A member's public profile plus their posts (hidden posts included only for
 * the member themself or a moderator). Free, no rate limit. Shared verbatim
 * by the web `getMemberProfile` server function and the mobile
 * `GET /api/v1/profile/member` route.
 */
export async function getMemberProfileForUser(
  supabase: MilaSupabaseClient,
  userId: string,
  data: MemberProfileInputData,
): Promise<MemberProfileResponse> {
  const roles = await getCurrentUserRoles(supabase, userId);
  const canViewHidden = data.user_id === userId || hasPermission(roles, "moderation.view");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const profileResult = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,username,color_season,face_shape,hair_type,created_at")
    .eq("id", data.user_id)
    .maybeSingle();
  if (profileResult.error || !profileResult.data) {
    throw new DomainValidationError("Member not found.");
  }
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
      is_self: post.user_id === userId,
      items: itemMap.get(post.id) ?? [],
    })),
  };
}
