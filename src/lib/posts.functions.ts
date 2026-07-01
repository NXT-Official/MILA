import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
  image_url_back: string; // signed
  image_url_front: string; // signed
  author_name: string | null;
  is_self: boolean;
}

export interface FeedResponse {
  has_posted_today: boolean;
  posts: FeedPost[];
}

const SIGNED_URL_TTL = 60 * 60; // 1 hour

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreatePostInput.parse(input))
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