import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { analyzeOutfitItemsForUser } from "@/server/services/items";
import {
  MAX_DETECTED_ITEMS,
  normalizeSourceUrl,
  type BBox,
  type ClothingAttributes,
  type PostItem,
} from "./outfit-items";

type PostItemRow = {
  id: string;
  label: string;
  category: string;
  attributes: Json;
  bbox: Json;
  source_url: string | null;
};

export function toPostItem(row: PostItemRow): PostItem {
  return {
    id: row.id,
    label: row.label,
    category: row.category,
    attributes: row.attributes as unknown as ClothingAttributes,
    bbox: row.bbox as unknown as BBox,
    source_url: row.source_url,
  };
}

const ITEM_COLUMNS = "id,label,category,attributes,bbox,source_url";

/**
 * Items for a set of posts, keyed by post id. RLS makes this visible exactly
 * when the post itself is, so both feed readers can share it.
 */
export async function loadPostItems(
  supabase: SupabaseClient<Database>,
  postIds: string[],
): Promise<Map<string, PostItem[]>> {
  const byPost = new Map<string, PostItem[]>();
  if (!postIds.length) return byPost;

  const { data, error } = await supabase
    .from("post_items")
    .select(`post_id,${ITEM_COLUMNS}`)
    .in("post_id", postIds)
    .order("created_at", { ascending: true });
  if (error) {
    // Tags are an enhancement; a feed without them still reads fine.
    console.error("[loadPostItems] failed", error.message);
    return byPost;
  }

  for (const row of data ?? []) {
    const list = byPost.get(row.post_id) ?? [];
    list.push(toPostItem(row));
    byPost.set(row.post_id, list);
  }
  return byPost;
}

const UpdatePostItemsInput = z.object({
  post_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        label: z.string().trim().min(1).max(100),
        source_url: z.string().max(2048).nullable(),
      }),
    )
    .max(MAX_DETECTED_ITEMS),
});

/**
 * Saves the poster's edits: renamed labels, where each piece is from, and the
 * removal of anything the model got wrong. Items missing from the list are
 * deleted, so an empty list clears every tag on the post.
 */
export const updatePostItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpdatePostItemsInput.parse(input))
  .handler(async ({ data, context }): Promise<PostItem[]> => {
    const { supabase, userId } = context;

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id")
      .eq("id", data.post_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (postError) throw new Error(postError.message);
    if (!post) throw new Error("Post not found.");

    // Poster links are untrusted. Anything that isn't https is refused rather
    // than quietly dropped, so a typo doesn't look like it saved.
    const items = data.items.map((item) => {
      const raw = item.source_url?.trim();
      const url = raw ? normalizeSourceUrl(raw) : null;
      if (raw && !url) throw new Error(`"${raw}" isn't a valid https link.`);
      return { ...item, source_url: url };
    });

    const keptIds = items.map((item) => item.id);
    let removals = supabase.from("post_items").delete().eq("post_id", data.post_id);
    if (keptIds.length) removals = removals.not("id", "in", `(${keptIds.join(",")})`);
    const { error: deleteError } = await removals;
    if (deleteError) throw new Error(deleteError.message);

    // At most MAX_DETECTED_ITEMS rows, each with different values — not worth a
    // bulk-upsert dance that would need every NOT NULL column resent.
    const updates = await Promise.all(
      items.map((item) =>
        supabase
          .from("post_items")
          .update({ label: item.label, source_url: item.source_url })
          .eq("id", item.id)
          .eq("post_id", data.post_id)
          .select(ITEM_COLUMNS)
          .maybeSingle(),
      ),
    );
    const failed = updates.find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);

    return updates.flatMap((result) => (result.data ? [toPostItem(result.data)] : []));
  });

export const AnalyzeOutfitItemsInput = z.object({ post_id: z.string().uuid() });
export type AnalyzeOutfitItemsInputData = z.infer<typeof AnalyzeOutfitItemsInput>;

/**
 * One vision call per post, not per garment: N calls would be N times the latency
 * and N times the credit spend for the same photo.
 */
export const analyzeOutfitItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => AnalyzeOutfitItemsInput.parse(input))
  .handler(async ({ data, context }): Promise<PostItem[]> =>
    analyzeOutfitItemsForUser(context.supabase, context.userId, data),
  );
